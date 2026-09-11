#!/usr/bin/env bash
# Runtime pin gate (BRAWUKA-190): one Node major and one TypeScript version
# across `web/`, `poi-service/`, `image-service/`, and a frozen Worker
# `compatibility_date`.
#
# Why this exists: no package declared `engines`, the two Workers used
# TypeScript `^7` while `web/` used `^5`, and both Workers pinned
# `compatibility_date = "2024-01-01"`. So "which runtime and toolchain is this
# commit built against" was answered by whatever the local machine happened to
# have installed (CI pins Node 22; the containers pin `node:22-*`). This gate
# turns those pins into a declared, machine-checked contract: a change that
# moves one package, one container, or one Worker alone fails here instead of
# surfacing later as a machine-specific difference.
#
# The Node pin is checked wherever it lives, not only in `ci.yml`:
# `nightly-recompute.yml` runs `npm ci` in `web/` against the production database
# every night, so the gate walks every workflow and attributes each
# `node-version` to the package that job installs into (BRAWUKA-202).
#
# What it deliberately does NOT check:
#   - `engine-strict`. Measured on npm 11: without it, an unsatisfiable
#     `engines` range is an `EBADENGINE` warning and `npm ci` still exits 0.
#     Turning it on would hard-fail local `npm ci` for a contributor on an
#     older Node and change nothing in CI (where the version is controlled), so
#     the pin is enforced by this gate, not by the installer.
#   - Equality between the two Workers' `compatibility_date` values. They carry
#     different runtime surface (image-service enables `nodejs_compat`,
#     poi-service does not), so both must be pinned, valid, and not in the
#     future — but each service adopting a newer runtime is a deliberate,
#     separate change by design.
set -euo pipefail

ROOT="${COFFEEMODE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT"

PACKAGES=(web poi-service image-service)
WORKERS=(poi-service image-service)
WORKFLOWS_DIR=".github/workflows"
WEB_DOCKERFILE="web/Dockerfile"
COMPOSE="docker-compose.yml"

ERRORS=0
fail() { echo "  FAIL: $*"; ERRORS=$((ERRORS+1)); }
ok()   { echo "  ok: $*"; }

echo "--- check-runtime-pins ---"

# Every input below is a file this repository must own; a missing one would
# otherwise turn a whole class of the check into a silent no-op. The harness
# self-test fixture copies all of them, so absence is a real failure, not a
# fixture artifact.
REQUIRED=()
for pkg in "${PACKAGES[@]}"; do
  REQUIRED+=("$pkg/package.json" "$pkg/package-lock.json")
done
for pkg in "${WORKERS[@]}"; do
  REQUIRED+=("$pkg/wrangler.toml")
done
REQUIRED+=("$WEB_DOCKERFILE" "$COMPOSE")

for required in "${REQUIRED[@]}"; do
  if [[ ! -f "$required" ]]; then
    fail "missing $required — cannot verify the runtime pins"
  fi
done

# The workflow set is discovered, never named: the pin lives in every workflow
# that provisions Node, and a hardcoded file list is exactly the blind spot this
# check exists to close. An absent or empty directory would instead leave the
# loop below with nothing to verify, so it is a failure, not an empty run.
WORKFLOW_FILES=()
for candidate in "$WORKFLOWS_DIR"/*.yml "$WORKFLOWS_DIR"/*.yaml; do
  [[ -f "$candidate" ]] || continue
  WORKFLOW_FILES+=("$candidate")
done
if [[ "${#WORKFLOW_FILES[@]}" -eq 0 ]]; then
  fail "$WORKFLOWS_DIR holds no workflow — no workflow Node pin can be verified"
fi

if [[ $ERRORS -gt 0 ]]; then
  echo ""
  echo "check-runtime-pins FAILED with $ERRORS error(s)."
  exit 1
fi

# --- 1. engines.node: same floor in every package, equal to the workflows and
# the images ---

# Reads the `"engines"` object out of a package.json (`awk`, so a one-line object
# works as well as the multi-line form).
engines_block() {
  awk '/"engines"[[:space:]]*:/{seen=1} seen{print} seen&&/\}/{exit}' "$1"
}

# The range grammar is intentionally narrow: a floor of `>=MAJOR[.MINOR[.PATCH]]`.
# Anything else (a caret, a disjunction, `*`) fails loudly rather than being
# mis-parsed into "consistent" — extend this gate when a real range is needed.
engine_floor() {
  local manifest="$1" line range
  line="$(engines_block "$manifest" | grep -E '"node"[[:space:]]*:' || true)"
  if [[ -z "$line" ]]; then
    echo ""
    return 0
  fi
  range="$(printf '%s\n' "$line" | sed -nE 's/.*"node"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/p')"
  if [[ ! "$range" =~ ^\>=([0-9]+)(\.[0-9]+){0,2}$ ]]; then
    echo "unsupported-range:$range"
    return 0
  fi
  printf '%s\n' "${BASH_REMATCH[1]}"
}

node_floor=""
# Parallel to PACKAGES: the declared floor of each package, empty when it is
# missing or unreadable. A package with an empty entry still fails every pin
# attributed to it, so this map can never turn a check into a silent pass.
FLOOR_RAW=()
for pkg in "${PACKAGES[@]}"; do
  manifest="$pkg/package.json"
  floor="$(engine_floor "$manifest")"
  case "$floor" in
    "") fail "$manifest declares no engines.node" ; FLOOR_RAW+=("") ; continue ;;
    unsupported-range:*)
      fail "$manifest engines.node \"${floor#unsupported-range:}\" is not a supported floor range (expected >=MAJOR[.MINOR[.PATCH]])"
      FLOOR_RAW+=("")
      continue
      ;;
  esac
  FLOOR_RAW+=("$floor")
  if [[ -z "$node_floor" ]]; then
    node_floor="$floor"
  elif [[ "$floor" != "$node_floor" ]]; then
    fail "$manifest engines.node floor is $floor but ${PACKAGES[0]} declares $node_floor — one Node major across the repo"
    continue
  fi
  ok "$manifest engines.node >=$floor"
done

# Each workflow pin is compared with its own package's floor, so a pin is
# attributed to the package that job installs into rather than to one
# repo-wide number.
floor_for() {
  local want="$1" i
  for i in "${!PACKAGES[@]}"; do
    if [[ "${PACKAGES[$i]}" == "$want" ]]; then
      printf '%s\n' "${FLOOR_RAW[$i]}"
      return 0
    fi
  done
  return 1
}

if [[ -z "$node_floor" ]]; then
  echo ""
  echo "check-runtime-pins FAILED with $ERRORS error(s)."
  exit 1
fi

# --- 1b. Workflow `node-version`: every job that installs into a package ---
#
# Any workflow that installs a package's dependencies and runs its code
# provisions Node itself, so the pin is not in one file. Each `node-version` is
# attributed to the package(s) that job installs into — its `working-directory`
# (job default or step), the setup-node step's `cache-dependency-path`, a `cd`
# into the package inside the install step (`cd web && pnpm install`), or a
# manager dir flag (`npm --prefix <pkg>`, `pnpm --dir <pkg>`,
# `yarn --cwd <pkg>`) — and compared with that package's own floor.
# `nightly-recompute.yml` (02:00 UTC, `web/`, production database) is why the
# single-file check was not enough: with `engine-strict` off, a floor bump that
# left it behind installs with an `EBADENGINE` warning and still exits 0.
#
# An install is recognised by what it does (fetch a package's dependencies),
# never by one command name: `npm`, `pnpm`, `yarn` and `bun` install verbs
# (`ci`, `clean-install`, `install`, `i`) and the frozen forms
# (`--frozen-lockfile`, yarn berry `--immutable`) all count. `corepack` only
# enables the manager that follows it, so `corepack enable && pnpm install` is
# covered by the manager branch.
#
# A `node-version` the gate cannot attribute to a package fails rather than
# skips, and so does a job that installs into a package the gate cannot name:
# "nothing detected" (SKIP) and "detected but unattributable" (BAD) are
# different records, so an installer this parser does not understand extends
# the gate instead of quietly escaping it. The walk is written in `awk` rather
# than with a YAML library, so the check keeps running where nothing is
# installed.
floors=""
for pkg in "${PACKAGES[@]}"; do
  floors+="${pkg}=$(floor_for "$pkg" || true),"
done
floors="${floors%,}"

workflow_pin_records() {
  awk -v floors="$floors" '
  BEGIN {
    pkgcount = split(floors, entry, ",")
    for (i = 1; i <= pkgcount; i++) {
      eq = index(entry[i], "=")
      if (eq > 0) {
        name = substr(entry[i], 1, eq - 1)
        FLOOR[name] = substr(entry[i], eq + 1)
        ORDER[i] = name
      }
    }
  }

  function indent_of(s) { match(s, /^ */); return RLENGTH }

  function strip_value(line,   v) {
    v = line
    sub(/^[^:]*:/, "", v)
    sub(/[[:space:]]+#.*$/, "", v)
    gsub(/["]/, "", v)
    gsub(/^[[:space:]]+|[[:space:]]+$/, "", v)
    return v
  }

  # A directory is only meaningful when a package owns it; `.`, `..` and any
  # other path are not package roots, so they map to nothing.
  function package_dir(value,   d) {
    d = strip_value(value)
    gsub(/^[.\/]+/, "", d)
    gsub(/\/+$/, "", d)
    return (d in FLOOR) ? d : ""
  }

  # Records are tab separated, and `read` collapses an empty field between two
  # tabs — so a job the walk could not name still emits a placeholder instead of
  # shifting every later field left.
  function emit(kind, line, dir, value) {
    printf "%s\t%s\t%d\t%s\t%s\n", kind, (job == "" ? "?" : job), line, dir, value
  }

  # A pin shape this gate cannot attribute is a failure, reported with the line
  # it sits on so the author sees which one must change.
  function bad(line, reason) {
    emit("BAD", line, "-", reason)
  }

  # An install fetches the dependencies of a package, whatever manager spells it:
  # `npm`/`pnpm`/`yarn`/`bun` install verbs (`ci`, `clean-install`, `install`,
  # `i`), with flags allowed between manager and verb
  # (`pnpm --dir web install`), plus the frozen forms that can stand without
  # the verb (`yarn --frozen-lockfile`, yarn berry `yarn --immutable`).
  # `corepack` only enables the manager named after it, so it needs no branch
  # of its own. Tool runners that never fetch (`npx`, `pnpm dlx`, `yarn run`,
  # `bunx`) name no install verb and stay excluded.
  function is_install(text) {
    if (text ~ /(^|[^[:alnum:]_-])(npm|pnpm|yarn|bun)[[:space:]]+(-[^[:space:]]+[[:space:]]+)*(ci|clean-install|install|i)([^[:alnum:]_-]|$)/) return 1
    if (text ~ /(^|[^[:alnum:]_-])(npm|pnpm|yarn|bun)([^[:alnum:]_-]|$)/ && text ~ /--frozen-lockfile|--immutable/) return 1
    return 0
  }

  # The install step itself can name the package: `cd web && pnpm install`,
  # `pushd poi-service`, or a manager dir flag (`npm --prefix <pkg>`,
  # `pnpm --dir <pkg>`, `yarn --cwd <pkg>`). Returns "" when nothing in the
  # step names a package this gate knows, which finish_job then fails rather
  # than mis-attributes.
  function install_dir(text,   s, target, pre, d) {
    s = text
    while (match(s, /(cd|pushd)[[:space:]]+[^[:space:];|&"]+/)) {
      target = substr(s, RSTART, RLENGTH)
      if (RSTART > 1) {
        pre = substr(s, RSTART - 1, 1)
        if (pre ~ /[[:alnum:]_-]/) { s = substr(s, RSTART + 1); continue }
      }
      sub(/^(cd|pushd)[[:space:]]+/, "", target)
      d = package_dir(target)
      if (d != "") return d
      s = substr(s, RSTART + RLENGTH)
    }
    s = text
    while (match(s, /--(prefix|dir|cwd)[[:space:]=]+[^[:space:];|&"]+/)) {
      target = substr(s, RSTART, RLENGTH)
      sub(/^--(prefix|dir|cwd)[[:space:]=]+/, "", target)
      d = package_dir(target)
      if (d != "") return d
      s = substr(s, RSTART + RLENGTH)
    }
    return ""
  }

  # Buffered until the job ends: the packages a job installs into are only fully
  # known after its last step.
  function finish_step(   d) {
    if (step_setup && step_has_node) {
      npins++
      pin_line[npins] = step_node_line
      pin_major[npins] = step_node_major
      pin_dir[npins] = step_wd_pkg
      if (pin_dir[npins] == "") pin_dir[npins] = job_wd_pkg
      if (pin_dir[npins] == "") pin_dir[npins] = step_cache_pkg
    }
    if (is_install(step_text)) {
      job_installs = 1
      if (step_wd_pkg != "") installed[step_wd_pkg] = 1
      else {
        d = install_dir(step_text)
        if (d != "") installed[d] = 1
      }
    }
    s = step_text
    while (match(s, /--prefix[[:space:]=]+[^[:space:]]+/)) {
      target = substr(s, RSTART, RLENGTH)
      sub(/^--prefix[[:space:]=]+/, "", target)
      d = package_dir(target)
      if (d != "") { installed[d] = 1; job_installs = 1 }
      s = substr(s, RSTART + RLENGTH)
    }
  }

  function finish_job(   i, d, k, n, seen, list) {
    for (i = 1; i <= npins; i++) {
      n = 0
      delete seen
      if (pin_dir[i] != "") { seen[pin_dir[i]] = 1; n++ }
      for (d in installed) if (!(d in seen)) { seen[d] = 1; n++ }
      if (n == 0) {
        if (job_installs) {
          bad(pin_line[i], "declares node-version but the gate cannot tell which package it installs into — give the job a defaults.run.working-directory, a step working-directory, a cache-dependency-path, or install inside the package directory (cd <pkg> / --prefix|--dir|--cwd <pkg>)")
        } else {
          emit("SKIP", pin_line[i], "-", pin_major[i])
        }
        continue
      }
      for (k = 1; k <= pkgcount; k++) {
        d = ORDER[k]
        if (d in seen) emit("PIN", pin_line[i], d, pin_major[i])
      }
    }
    if (job_installs && npins == 0) {
      list = ""
      for (k = 1; k <= pkgcount; k++) {
        d = ORDER[k]
        if (d in installed) list = list (list == "" ? "" : ", ") d
      }
      if (list == "") list = job_wd_pkg
      if (list == "") list = "a directory the gate cannot attribute"
      bad(job_line, "installs dependencies in " list " but pins no node-version — the run would use whatever Node the runner ships")
    }
  }

  function reset_step() {
    step_text = ""; step_setup = 0; step_wd_pkg = ""; step_cache_pkg = ""
    step_has_node = 0; step_node_line = 0; step_node_major = ""
  }

  function reset_job() {
    job = ""; job_line = 0; job_wd_pkg = ""; job_installs = 0; npins = 0
    in_defaults = 0; defaults_run = 0; in_steps = 0
    delete installed
    reset_step()
  }

  BEGIN { reset_job(); injobs = 0; candidates = 0; recorded = 0 }

  # Blocks are tracked by indentation, which these workflows write with two
  # spaces per level. A file written with another width is not read as one job
  # with steps: its pins are reported as unattributable, and the
  # `candidates == recorded` guard in END catches any pin the walk stepped over
  # entirely — either way the gate fails instead of mis-attributing a pin.
  {
    line = $0
    ind = indent_of(line)
    # Counted before any other rule can `next` past the line, so the guard in
    # END catches a structure this parser walked out of.
    if (line ~ /^[[:space:]]*node-version:/) candidates++

    if (line ~ /^jobs:[[:space:]]*$/) { injobs = 1; next }
    if (!injobs) next

    if (ind == 2 && line !~ /^[[:space:]]*#/) {
      finish_step()
      finish_job()
      reset_job()
      job = line
      sub(/^[[:space:]]+/, "", job)
      sub(/:.*$/, "", job)
      job_line = NR
      next
    }

    is_comment = (line ~ /^[[:space:]]*#/)
    is_blank = (line ~ /^[[:space:]]*$/)

    # Only a real dedent leaves a block: a blank line carries no indentation at
    # all and must not end the `steps:` it sits inside.
    if (!is_blank && ind <= 4) {
      in_defaults = 0
      in_steps = 0
    }
    if (line ~ /^    defaults:[[:space:]]*$/) { in_defaults = 1; defaults_run = 0; next }
    if (line ~ /^    steps:[[:space:]]*$/) { in_steps = 1; next }

    if (in_defaults) {
      if (line ~ /^      run:[[:space:]]*$/) { defaults_run = 1; next }
      if (defaults_run && line ~ /^        working-directory:/) {
        job_wd_pkg = package_dir(line)
      }
      next
    }

    # The pin lives in one place: the `with:` block of a setup-node step, which
    # is where the runtime for that job is chosen. Any other `node-version:` — a
    # matrix axis, another action — is a shape this gate cannot attribute, and
    # fails with its own line instead of being silently skipped.
    if (line ~ /^[[:space:]]*node-version:/) {
      pin_key = line
      sub(/^[[:space:]]*(-[[:space:]]+)?/, "", pin_key)
      if (in_steps && step_setup) {
        step_has_node = 1
        step_node_line = NR
        step_node_major = strip_value(pin_key)
      } else {
        bad(NR, "declares node-version outside an actions/setup-node step — the gate cannot tell which package engines it must satisfy")
      }
      recorded++
    }

    if (in_steps) {
      if (ind == 6 && line ~ /^      -[[:space:]]/) {
        finish_step()
        reset_step()
      }
      if (!is_comment) step_text = step_text "\n" line

      key = line
      sub(/^[[:space:]]*(-[[:space:]]+)?/, "", key)

      if (key ~ /^uses:[[:space:]]*actions\/setup-node([@[:space:]]|$)/) step_setup = 1
      if (key ~ /^working-directory:/) step_wd_pkg = package_dir(key)
      if (key ~ /^cache-dependency-path:/) {
        cache = strip_value(key)
        sub(/\/.*$/, "", cache)
        step_cache_pkg = package_dir(cache)
      }
      next
    }
  }

  END {
    finish_step()
    finish_job()
    if (candidates != recorded) {
      emit("BAD", 0, "-", candidates " node-version pin(s) but only " recorded " attributed — extend this gate for the structure it could not read")
    }
  }
  ' "$1"
}

check_workflow_pins() {
  local wf="$1" records kind wjob wline wdir wvalue floor
  records="$(workflow_pin_records "$wf")" || {
    fail "$wf could not be parsed for node-version pins"
    return 0
  }
  [[ -n "$records" ]] || return 0
  while IFS=$'\t' read -r kind wjob wline wdir wvalue; do
    [[ -n "$kind" ]] || continue
    case "$kind" in
      PIN)
        floor="$(floor_for "$wdir" || true)"
        if [[ -z "$floor" ]]; then
          fail "$wf:$wline job $wjob pins node-version: $wvalue but $wdir/package.json declares no readable engines.node floor"
        elif [[ "$wvalue" != "$floor" ]]; then
          fail "$wf:$wline job $wjob pins node-version: $wvalue but $wdir/package.json floors engines.node at >=$floor"
        else
          ok "$wf job $wjob node-version: $wvalue matches $wdir/package.json engines.node >=$floor"
        fi
        ;;
      SKIP)
        ok "$wf job $wjob node-version: $wvalue — no npm/pnpm/yarn/bun install detected in this job, so no package floor applies"
        ;;
      BAD)
        fail "$wf:$wline job $wjob $wvalue"
        ;;
    esac
  done <<< "$records"
}

for wf in "${WORKFLOW_FILES[@]}"; do
  check_workflow_pins "$wf"
done

# Containers are the other place the runtime is pinned: a Dockerfile or compose
# image that drifts from `engines` ships a different Node than CI tests.
check_image_majors() {
  local file="$1" pattern="$2" majors
  majors="$(grep -oE "$pattern" "$file" | sed -nE 's/.*node:([0-9]+).*/\1/p' | sort -u)"
  if [[ -z "$majors" ]]; then
    fail "$file declares no node image — the container runtime is unverifiable"
    return 0
  fi
  while IFS= read -r major; do
    if [[ "$major" != "$node_floor" ]]; then
      fail "$file uses a node:$major image but engines.node floors at >=$node_floor"
    else
      ok "$file node image major $major matches engines.node"
    fi
  done <<< "$majors"
}

check_image_majors "$WEB_DOCKERFILE" 'FROM[[:space:]]+node:[0-9]+[0-9a-z.-]*'
check_image_majors "$COMPOSE" 'image:[[:space:]]*node:[0-9]+[0-9a-z.-]*'

# --- 2. TypeScript: one declared range, one resolved version, in all three ---

ts_range=""
ts_resolved=""
ts_aligned=0
for pkg in "${PACKAGES[@]}"; do
  manifest="$pkg/package.json"
  lock="$pkg/package-lock.json"
  pkg_aligned=1

  range="$(sed -nE 's/.*"typescript"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/p' "$manifest" | head -1)"
  if [[ -z "$range" ]]; then
    fail "$manifest declares no typescript dependency"
    continue
  fi
  if [[ -z "$ts_range" ]]; then
    ts_range="$range"
  elif [[ "$range" != "$ts_range" ]]; then
    fail "$manifest declares typescript $range but ${PACKAGES[0]} declares $ts_range — one TypeScript version across the repo"
    pkg_aligned=0
  fi

  # lockfileVersion 3 puts `packages` first, so the first match is
  # `packages["node_modules/typescript"]`; its `version` is the next line. A
  # formatting change makes the extraction empty, which fails below instead of
  # passing silently.
  resolved="$(awk '/^[[:space:]]*"node_modules\/typescript":/{getline; print; exit}' "$lock" |
    sed -nE 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/p')"
  if [[ ! "$resolved" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]]; then
    fail "$lock: could not read the installed typescript version (got \"${resolved:-<empty>}\")"
    continue
  fi
  if [[ -z "$ts_resolved" ]]; then
    ts_resolved="$resolved"
  elif [[ "$resolved" != "$ts_resolved" ]]; then
    fail "$lock resolves typescript $resolved but the first package resolves $ts_resolved — lockfiles must agree"
    pkg_aligned=0
  fi

  # The declared range and the version the lockfile actually installs must be
  # the same major, or "aligned" is only a claim about package.json.
  declared_major="$(sed -nE 's/^[~^]?([0-9]+).*/\1/p' <<< "$range")"
  if [[ "$declared_major" != "${resolved%%.*}" ]]; then
    fail "$manifest declares typescript $range but $lock installs $resolved (major drift)"
    pkg_aligned=0
  fi

  ts_aligned=$((ts_aligned + pkg_aligned))
done

if [[ "$ts_aligned" -eq "${#PACKAGES[@]}" ]]; then
  ok "typescript $ts_range (resolved $ts_resolved) agrees across all ${#PACKAGES[@]} packages"
fi

# --- 3. Worker compatibility_date: pinned, valid, never in the future ---

# A future date does not fail the build; it silently adopts whatever runtime
# flags land between now and then, which is exactly the "drifts with the
# release" behaviour the pin is meant to prevent. UTF-8 zero-padded ISO dates
# compare correctly as strings.
today="$(date -u +%Y-%m-%d)"
for pkg in "${WORKERS[@]}"; do
  config="$pkg/wrangler.toml"
  date_value="$(sed -nE 's/^compatibility_date[[:space:]]*=[[:space:]]*"([^"]*)".*/\1/p' "$config" | head -1)"
  if [[ -z "$date_value" ]]; then
    fail "$config declares no compatibility_date — the Worker runtime version would move with the platform"
    continue
  fi
  if [[ ! "$date_value" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    fail "$config compatibility_date \"$date_value\" is not an ISO date"
    continue
  fi
  if [[ "$date_value" > "$today" ]]; then
    fail "$config compatibility_date $date_value is in the future (today is $today) — flags would enable themselves as Cloudflare ships them"
    continue
  fi
  ok "$config pins compatibility_date $date_value"
done

if [[ $ERRORS -gt 0 ]]; then
  echo ""
  echo "check-runtime-pins FAILED with $ERRORS error(s)."
  exit 1
fi

echo ""
echo "check-runtime-pins PASSED."
