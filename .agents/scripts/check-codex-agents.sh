#!/usr/bin/env bash
# Validate the .codex agent configuration TOMLs.
# Parses only the small TOML subset used by project agent bindings so
# duplicate keys and unsupported syntax fail closed without adding a
# package dependency.
# Adapted from CanCan's check-codex-agents.sh.
set -euo pipefail

ROOT="${COFFEEMODE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT"

if ! command -v ruby >/dev/null 2>&1; then
  echo "Missing required agent-config dependency: ruby"
  exit 1
fi

ruby - <<'RUBY'
def invalid(path, line, message)
  location = line ? "#{path}:#{line}" : path.to_s
  raise "Invalid Codex agent configuration #{location}: #{message}"
end

def validate_multiline_basic_string(path, start_line, value)
  index = 0
  while index < value.length
    character = value[index]
    if character == "\\"
      line = start_line + value[0...index].count("\n") + 1
      cursor = index + 1
      invalid(path, line, "unterminated escape in multiline string") if cursor >= value.length

      escape = value[cursor]
      if ['"', "\\", "b", "t", "n", "f", "r"].include?(escape)
        index = cursor + 1
        next
      end

      if escape == "u" || escape == "U"
        digits = escape == "u" ? 4 : 8
        encoded = value[(cursor + 1), digits]
        unless encoded&.match?(/\A[0-9A-Fa-f]{#{digits}}\z/)
          invalid(path, line, "invalid Unicode escape in multiline string")
        end
        scalar = encoded.to_i(16)
        if scalar > 0x10FFFF || (0xD800..0xDFFF).cover?(scalar)
          invalid(path, line, "invalid Unicode scalar in multiline string")
        end
        index = cursor + digits + 1
        next
      end

      cursor += 1 while cursor < value.length && [" ", "\t"].include?(value[cursor])
      if value[cursor] == "\n"
        cursor += 1
        cursor += 1 while cursor < value.length && [" ", "\t", "\n"].include?(value[cursor])
        index = cursor
        next
      end

      invalid(path, line, "invalid escape \\#{escape} in multiline string")
    end

    if character == '"' && value[index, 3] == '"""'
      line = start_line + value[0...index].count("\n") + 1
      invalid(path, line, 'unescaped """ in multiline string')
    end

    if (character.ord < 0x20 && character != "\n" && character != "\t") || character.ord == 0x7F
      line = start_line + value[0...index].count("\n") + 1
      invalid(path, line, "control character in multiline string")
    end
    index += 1
  end
end

def parse_toml(path, sectioned:)
  invalid(path, nil, "file is missing") unless File.file?(path)

  values = {}
  section = nil
  seen_sections = {}
  multiline_key = nil
  multiline_start = nil
  multiline_value = []

  File.readlines(path, chomp: true, encoding: "UTF-8").each_with_index do |line, index|
    line_number = index + 1

    if multiline_key
      if line.strip == '"""'
        value = multiline_value.join("\n")
        validate_multiline_basic_string(path, multiline_start, "#{value}\n")
        values[multiline_key] = value
        multiline_key = nil
        multiline_start = nil
        multiline_value = []
      else
        multiline_value << line
      end
      next
    end

    stripped = line.strip
    next if stripped.empty? || stripped.start_with?("#")

    if (match = stripped.match(/^\[([A-Za-z_][A-Za-z0-9_-]*)\]$/))
      invalid(path, line_number, "sections are not allowed") unless sectioned
      section = match[1]
      invalid(path, line_number, "duplicate section #{section}") if seen_sections[section]
      seen_sections[section] = true
      next
    end

    key_match = stripped.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(.*)$/)
    invalid(path, line_number, "unsupported syntax") unless key_match

    key = key_match[1]
    qualified_key = section ? "#{section}.#{key}" : key
    invalid(path, line_number, "key outside a section") if sectioned && section.nil?
    invalid(path, line_number, "duplicate key #{qualified_key}") if values.key?(qualified_key)

    raw_value = key_match[2]
    if raw_value == '"""'
      multiline_key = qualified_key
      multiline_start = line_number
    elsif (match = raw_value.match(/^"([^"\\]*)"$/))
      values[qualified_key] = match[1]
    elsif raw_value.match?(/^-?[0-9]+$/)
      values[qualified_key] = raw_value.to_i
    else
      invalid(path, line_number, "unsupported value for #{qualified_key}")
    end
  end

  invalid(path, multiline_start, "unterminated multiline string for #{multiline_key}") if multiline_key
  values
end

begin
  config_path = ".codex/config.toml"
  expected_config = {
    "agents.max_threads" => 4,
    "agents.max_depth" => 1,
  }
  config = parse_toml(config_path, sectioned: true)
  raise "Unexpected Codex concurrency configuration in #{config_path}: #{config.inspect}" unless config == expected_config

  expected_agents = {
    "explorer" => ["gpt-5.6-sol", "high", "read-only"],
    "implementer" => ["gpt-5.6-terra", "max", nil],
    "tester" => ["gpt-5.6-luna", "max", "workspace-write"],
    "reviewer" => ["gpt-5.6-sol", "high", "read-only"],
  }
  agents_dir = ".codex/agents"
  expected_files = expected_agents.keys.map { |name| "#{name}.toml" }.sort
  actual_files = Dir.glob("#{agents_dir}/*.toml").map { |path| File.basename(path) }.sort
  unless actual_files == expected_files
    raise "Unexpected Codex agent files in #{agents_dir}: expected #{expected_files.inspect}, found #{actual_files.inspect}"
  end

  base_required_keys = %w[
    name
    description
    developer_instructions
    model
    model_reasoning_effort
  ].sort

  expected_agents.each do |name, (model, effort, sandbox)|
    path = ".codex/agents/#{name}.toml"
    agent = parse_toml(path, sectioned: false)
    required_keys = base_required_keys + (sandbox ? ["sandbox_mode"] : [])
    raise "Unexpected keys in #{path}: #{agent.keys.sort.inspect}" unless agent.keys.sort == required_keys

    expected_values = {
      "name" => name,
      "model" => model,
      "model_reasoning_effort" => effort,
    }
    expected_values["sandbox_mode"] = sandbox if sandbox
    expected_values.each do |key, expected|
      raise "Unexpected #{key} in #{path}: #{agent[key].inspect}" unless agent[key] == expected
    end

    %w[description developer_instructions].each do |key|
      raise "#{path} requires non-empty #{key}" unless agent[key].is_a?(String) && !agent[key].strip.empty?
    end

    if name == "reviewer" && !agent["developer_instructions"].include?(".agents/workflows/review-code.md")
      raise "#{path} must delegate the detailed review loop to .agents/workflows/review-code.md"
    end
    if name == "tester" && !agent["developer_instructions"].include?(".agents/workflows/development-cycle.md")
      raise "#{path} must delegate the detailed testing loop to .agents/workflows/development-cycle.md"
    end
  end
rescue StandardError => error
  warn error.message
  exit 1
end
RUBY

echo "Codex agent configuration check passed."
