#!/usr/bin/env ruby
# Machine-checked slice loading for CoffeeMode.
# Commands: check | list | context <slice-id>
# The manifest table shape is the contract; harness scripts parse it.

ROOT = File.expand_path(ENV.fetch("COFFEEMODE_ROOT", File.join(__dir__, "../..")))
MANIFEST = File.join(ROOT, "docs/agent/implementation-slices.md")
HEADER = ["ID", "Title", "Status", "Specs", "Dependencies", "Active blockers", "Test gates", "Outcome"].freeze
STATUSES = %w[BLOCKED READY IN-PROGRESS COMPLETE].freeze

def fail!(message)
  warn message
  exit 1
end

def cells(line)
  stripped = line.strip
  return nil unless stripped.start_with?("|") && stripped.end_with?("|")

  stripped[1...-1].split("|", -1).map(&:strip)
end

def list(cell)
  return [] if cell == "none"

  cell.delete("`").split(",").map(&:strip).reject(&:empty?)
end

def spec_path(number)
  matches = Dir.glob(File.join(ROOT, "docs/specs/#{number}-*.md"))
  fail!("No spec file found for spec number #{number}.") if matches.empty?
  fail!("Ambiguous spec number #{number}: #{matches.length} files.") if matches.length > 1

  matches.first.sub("#{ROOT}/", "")
end

def load_slices
  lines = File.readlines(MANIFEST, chomp: true)
  header_index = lines.index { |line| cells(line) == HEADER }
  fail!("Implementation slice table header is missing or changed.") unless header_index

  separator = cells(lines.fetch(header_index + 1, ""))
  unless separator&.length == HEADER.length && separator.all? { |value| value.match?(/\A-+\z/) }
    fail!("Implementation slice table separator is invalid.")
  end

  rows = []
  lines[(header_index + 2)..-1].to_a.each do |line|
    row = cells(line)
    break unless row
    fail!("Slice row has #{row.length} columns, expected #{HEADER.length}: #{line}") unless row.length == HEADER.length
    rows << HEADER.zip(row).to_h
  end
  fail!("Implementation slice table has no rows.") if rows.empty?
  rows
end

def validate!(slices)
  ids = slices.map { |slice| slice.fetch("ID") }
  duplicate = ids.group_by(&:itself).find { |_id, matches| matches.length > 1 }
  fail!("Duplicate slice ID: #{duplicate[0]}") if duplicate

  positions = ids.each_with_index.to_h

  slices.each do |slice|
    id = slice.fetch("ID")
    fail!("Invalid slice ID: #{id}") unless id.match?(/\A[a-z0-9]+(?:-[a-z0-9]+)*\z/)

    status = slice.fetch("Status")
    fail!("Invalid status for slice #{id}: #{status}") unless STATUSES.include?(status)

    specs = list(slice.fetch("Specs"))
    fail!("Slice #{id} has no required specs.") if specs.empty?
    specs.each do |number|
      fail!("Slice #{id} spec reference is not a 4-digit number: #{number}") unless number.match?(/\A\d{4}\z/)
      spec_path(number)
    end

    fail!("Slice #{id} has no test gates.") if slice.fetch("Test gates").strip.empty? || slice.fetch("Test gates") == "none"
    fail!("Slice #{id} has no outcome.") if slice.fetch("Outcome").strip.empty? || slice.fetch("Outcome") == "none"

    list(slice.fetch("Dependencies")).each do |dependency|
      fail!("Slice #{id} depends on unknown slice: #{dependency}") unless positions.key?(dependency)
      fail!("Slice #{id} must appear after dependency #{dependency}.") unless positions.fetch(dependency) < positions.fetch(id)
    end
  end

  # Cycle detection
  visiting = {}
  visited = {}
  walk = lambda do |id|
    fail!("Slice dependency cycle includes #{id}.") if visiting[id]
    return if visited[id]

    visiting[id] = true
    slice = slices.find { |candidate| candidate.fetch("ID") == id }
    list(slice.fetch("Dependencies")).each { |dependency| walk.call(dependency) }
    visiting.delete(id)
    visited[id] = true
  end
  ids.each { |id| walk.call(id) }

  by_id = slices.each_with_object({}) { |slice, result| result[slice.fetch("ID")] = slice }
  slices.each do |slice|
    id = slice.fetch("ID")
    status = slice.fetch("Status")
    blockers = list(slice.fetch("Active blockers"))
    incomplete_dependencies = list(slice.fetch("Dependencies")).reject do |dependency|
      by_id.fetch(dependency).fetch("Status") == "COMPLETE"
    end

    if %w[READY IN-PROGRESS COMPLETE].include?(status) && !incomplete_dependencies.empty?
      fail!("Slice #{id} is #{status} but dependencies are not COMPLETE: #{incomplete_dependencies.join(", ")}")
    end
    if %w[READY IN-PROGRESS COMPLETE].include?(status) && !blockers.empty?
      fail!("Slice #{id} is #{status} but still has active blockers: #{blockers.join(", ")}")
    end
    if status == "BLOCKED" && blockers.empty? && incomplete_dependencies.empty?
      fail!("Slice #{id} is BLOCKED without an active blocker or incomplete dependency.")
    end
  end
end

def dependency_closure(slice, slices, result = [])
  by_id = slices.each_with_object({}) { |entry, index| index[entry.fetch("ID")] = entry }
  list(slice.fetch("Dependencies")).each do |dependency|
    dependency_slice = by_id.fetch(dependency)
    dependency_closure(dependency_slice, slices, result)
    result << dependency_slice unless result.include?(dependency_slice)
  end
  result
end

def print_source_index(path)
  full_path = File.join(ROOT, path)
  fail!("Canonical source missing: #{path}") unless File.file?(full_path)

  lines = File.readlines(full_path, chomp: true)
  puts
  puts "## Required source: #{path}"
  headings = lines.each_with_index.each_with_object([]) do |(line, index), result|
    result << "- L#{index + 1}: #{line}" if line.match?(/\A\#{1,6}\s/)
  end
  if headings.empty?
    puts "- No Markdown headings; inspect the file directly."
  else
    puts headings
  end
end

slices = load_slices
validate!(slices)

case ARGV[0] || "check"
when "check"
  puts "Implementation slice check passed (#{slices.length} slices)."
when "list"
  slices.each { |slice| puts slice.fetch("ID") }
when "context"
  id = ARGV[1]
  fail!("Usage: implementation-slices.rb context <slice-id>") if id.nil? || id.empty?
  slice = slices.find { |candidate| candidate.fetch("ID") == id }
  fail!("Unknown slice '#{id}'. Available: #{slices.map { |entry| entry.fetch("ID") }.join(", ")}") unless slice

  puts "# CoffeeMode Implementation Context: #{id}"
  puts
  HEADER.each { |key| puts "- #{key}: #{slice.fetch(key)}" }
  dependencies = dependency_closure(slice, slices)
  incomplete_dependencies = dependencies.reject { |entry| entry.fetch("Status") == "COMPLETE" }
  puts
  if slice.fetch("Status") == "COMPLETE"
    puts "Implementation readiness: COMPLETE"
  elsif slice.fetch("Status") == "IN-PROGRESS"
    puts "Implementation readiness: IN PROGRESS (one writer; finish before starting another slice)"
  elsif slice.fetch("Status") == "BLOCKED" || !incomplete_dependencies.empty?
    puts "Implementation readiness: STOP"
    puts "- slice status: #{slice.fetch("Status")}"
    unless incomplete_dependencies.empty?
      puts "- incomplete dependencies: #{incomplete_dependencies.map { |entry| entry.fetch("ID") }.join(", ")}"
    end
  else
    puts "Implementation readiness: READY"
  end

  global_sources = [
    "AGENTS.md",
    "docs/STRUCTURE.md",
    "docs/agent/current-state.md",
    "docs/agent/reading-order.md"
  ]
  spec_sources = list(slice.fetch("Specs")).map { |number| spec_path(number) }

  puts
  puts "# Canonical Source Index"
  puts
  puts "Open these exact repository files directly. This packet indexes authority and readiness; it does not summarize or replace source content."
  (global_sources + spec_sources).uniq.each do |path|
    print_source_index(path)
  end
else
  fail!("Unknown command '#{ARGV[0]}'. Use check, list, or context.")
end
