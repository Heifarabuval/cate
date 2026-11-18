// Runs cate-fork-update.sh, cate-fork-install.sh and cate-fork-uninstall.sh inside a
// throwaway HOME, with fake git, npm, node, launchctl, osascript, pgrep, codesign,
// ditto and xattr first in PATH. The fakes record their calls; nothing real runs:
// no launchctl, no build, no /Applications. The PATH holds only the fakes and
// symlinks to the basic utilities, so a real git or node on the machine is never seen.
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPTS = path.resolve(import.meta.dirname);
const UPDATE = path.join(SCRIPTS, "cate-fork-update.sh");
const INSTALL = path.join(SCRIPTS, "cate-fork-install.sh");
const UNINSTALL = path.join(SCRIPTS, "cate-fork-uninstall.sh");
const SHA = "a".repeat(40);
const SHA2 = "b".repeat(40);
const ENGINES = '{\\n  "engines": {\\n    "node": ">=22.16 <23"\\n  }\\n}\\n'; // as printf reads it
const LONG_DASH = String.fromCharCode(0x2014);
const BASIC =
  "sh awk sed grep cat date mkdir rmdir rm mv cp ls dirname basename head tail cut wc id chmod touch mktemp find cmp ps".split(
    " ",
  );

// A test must never write outside a temporary folder or under the real HOME.
export function assertSandbox(home) {
  const real = realpathSync(os.homedir());
  const tmp = realpathSync(os.tmpdir());
  const h = realpathSync(home);
  if (
    h === real ||
    !h.startsWith(tmp + path.sep) ||
    process.env.HOME === home
  ) {
    throw new Error(`refusing to run outside a temporary HOME: ${home}`);
  }
}

function which(name) {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const p = path.join(dir, name);
    if (existsSync(p)) return p;
  }
  throw new Error(`utility not found on this machine: ${name}`);
}

const describeUnix = process.platform === "win32" ? describe.skip : describe;

describeUnix(
  "cate-fork scripts (fake HOME, fake commands)",
  { timeout: 60000 },
  () => {
    let root, home, fakes, calls, apps, build;

    const write = (file, text, mode) => {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, text);
      if (mode) chmodSync(file, mode);
    };
    const fake = (name, body, dir = fakes) =>
      write(
        path.join(dir, name),
        `#!/bin/sh\necho "$(basename "$0")@$(dirname "$0") $*" >> "$CALLS"\n${body}\n`,
        0o755,
      );
    // A node install: node and npm side by side, like nvm, fnm or Homebrew.
    const addNode = (dir, version) => {
      write(path.join(dir, ".version"), `${version}\n`);
      fake(
        "node",
        `d=$(dirname "$0")
if [ "$1" = "-v" ]; then cat "$d/.version"; exit 0; fi
if [ "$1" = "scripts/package.mjs" ]; then
  echo "SELF_UPDATE=\${CATE_SELF_UPDATE-unset} $*" >> "$CALLS"
  [ "\${FAKE_PACKAGE_FAIL:-0}" = 0 ] || exit 1
  mkdir -p release/mac-arm64/Cate.app/Contents; echo new > release/mac-arm64/Cate.app/Contents/id
fi`,
        dir,
      );
      fake(
        "npm",
        '[ "$1 $2" != "ci --no-audit" ] || [ "${FAKE_NPM_FAIL:-0}" = 0 ] || exit 1',
        dir,
      );
    };
    const nvm = (v) =>
      addNode(path.join(home, ".nvm/versions/node", `v${v}`, "bin"), `v${v}`);

    const envFor = (env) => ({
      HOME: home,
      PATH: `${fakes}${path.delimiter}${path.join(root, "base")}`,
      CALLS: calls,
      CATE_BUILD_DIR: build,
      CATE_APPS_DIR: apps,
      CATE_BREW_PREFIXES: path.join(root, "brew"),
      CATE_FORK_RAW_URL: "https://raw.example.test/scripts",
      SRC_SCRIPTS: SCRIPTS,
      ...env,
    });
    const run = (script, args = [], env = {}, input) => {
      assertSandbox(home);
      const r = spawnSync(
        "/bin/sh",
        input === undefined ? [script, ...args] : ["-s", "--", ...args],
        { env: envFor(env), cwd: root, input, encoding: "utf8" },
      );
      return { code: r.status, out: r.stdout + r.stderr };
    };
    const runAsync = (script, args = [], env = {}) => {
      assertSandbox(home);
      return new Promise((resolve) => {
        const child = spawn("/bin/sh", [script, ...args], {
          env: envFor(env),
          cwd: root,
        });
        child.on("close", (code) => resolve(code));
      });
    };
    // A real repository (fake PATH git delegates to it when REAL_GIT is set).
    const realGit = (() => {
      try {
        const g = which("git");
        return spawnSync(g, ["--version"]).status === 0 ? g : null;
      } catch {
        return null;
      }
    })();
    const makeRepo = (dir, origin) => {
      mkdirSync(dir, { recursive: true });
      const g = (...a) =>
        spawnSync(
          realGit,
          [
            "-C",
            dir,
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "-c",
            "commit.gpgsign=false",
            ...a,
          ],
          { env: { HOME: home, PATH: process.env.PATH } },
        );
      g("init", "-q");
      g("remote", "add", "origin", origin);
      writeFileSync(path.join(dir, ".gitignore"), ".env\n");
      g("add", ".gitignore");
      g("commit", "-q", "-m", "init");
      writeFileSync(path.join(dir, ".env"), "SECRET=1\n");
    };
    const log = () => {
      const f = path.join(home, "Library/Logs/cate-fork-update.log");
      return existsSync(f) ? readFileSync(f, "utf8") : "";
    };
    const called = () =>
      existsSync(calls)
        ? readFileSync(calls, "utf8").split("\n").filter(Boolean)
        : [];
    const count = (re) => called().filter((l) => re.test(l)).length;
    const uid = () =>
      spawnSync("id", ["-u"], { encoding: "utf8" }).stdout.trim();
    const tree = (dir, skip = /Logs/) => {
      const out = [];
      const walk = (d) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, e.name);
          if (skip.test(p)) continue;
          out.push(
            e.isDirectory()
              ? `${p}/`
              : `${p} ${readFileSync(p, "utf8").length}`,
          );
          if (e.isDirectory()) walk(p);
        }
      };
      walk(dir);
      return out.sort();
    };

    // A live process whose command line names cate-fork-update, like a real run.
    const liveRun = (name = "cate-fork-update") => {
      const script = path.join(root, name);
      write(script, "sleep 60; :\n");
      const child = spawn("/bin/sh", [script], { detached: true, stdio: "ignore" });
      return { pid: child.pid, stop: () => process.kill(-child.pid, "SIGKILL") };
    };

    beforeEach(() => {
      root = mkdtempSync(path.join(os.tmpdir(), "cate-fork-test-"));
      home = path.join(root, "home");
      fakes = path.join(root, "fakes");
      calls = path.join(root, "calls.log");
      apps = path.join(root, "apps");
      build = path.join(home, ".local/share/cate-build");
      mkdirSync(home);
      mkdirSync(apps);
      mkdirSync(path.join(root, "base"));
      for (const t of BASIC) symlinkSync(which(t), path.join(root, "base", t));
      fake("uname", 'echo "${FAKE_UNAME:-Darwin}"');
      fake(
        "xcode-select",
        '[ "${FAKE_NO_CLT:-0}" = 0 ] || exit 2; echo /Library/Developer/CommandLineTools',
      );
      fake(
        "git",
        `[ -z "\${REAL_GIT:-}" ] || exec "$REAL_GIT" "$@"
dir=""
case "$1" in -C) dir=$2; shift 2 ;; esac
case "$1" in
  clone) url=$3; for last; do :; done; mkdir -p "$last/.git"; echo "$url" > "$last/.git/origin"; printf '${ENGINES}' > "$last/package.json" ;;
  config) cat "$dir/.git/origin" 2>/dev/null || echo https://github.com/Heifarabuval/cate.git ;;
  fetch) [ "\${FAKE_FETCH_FAIL:-0}" = 0 ] || exit 1 ;;
  rev-parse) echo "\${FAKE_SHA:-${SHA}}" ;;
  show) case "$2" in
      *:scripts/cate-fork-update.sh) cat "\${FAKE_SELF:-$SRC_SCRIPTS/cate-fork-update.sh}" ;;
      *) printf '${ENGINES}' ;;
    esac ;;
  ls-remote) [ "\${FAKE_NO_NET:-0}" = 0 ] || exit 128 ;;
esac`,
      );
      fake(
        "codesign",
        'if [ "${FAKE_HARDENED:-0}" = 0 ]; then echo "flags=0x2(adhoc)" >&2; else echo "flags=0x10002(adhoc,runtime)" >&2; fi',
      );
      fake("ditto", 'cp -R "$1" "$2"');
      fake("xattr", "true");
      fake("osascript", "true");
      fake("launchctl", "true");
      fake("pgrep", '[ "${FAKE_CATE_OPEN:-0}" = 1 ]');
      fake(
        "df",
        'echo "Filesystem 1K-blocks Used Available Capacity Mounted"; echo "x 1 1 ${FAKE_DF_KB:-90000000} 1% /"',
      );
      fake(
        "curl",
        `[ "\${FAKE_CURL_FAIL:-0}" = 0 ] || exit 22
out=""; prev=""; url=""; for a; do [ "$prev" != "-o" ] || out=$a; prev=$a; url=$a; done
cp "$SRC_SCRIPTS/$(basename "$url")" "$out"`,
      );
    });
    afterEach(() => rmSync(root, { recursive: true, force: true }));

    it("refuses a HOME that is not a temporary folder", () => {
      expect(() => assertSandbox(os.homedir())).toThrow(/refusing/);
      expect(() => assertSandbox(home)).not.toThrow();
    });

    it("has no personal path or long dash, and passes a syntax check", () => {
      for (const f of [UPDATE, INSTALL, UNINSTALL]) {
        const text = readFileSync(f, "utf8");
        expect(text).not.toMatch(/\/Users\/|ADFINITAS/);
        expect(text.includes(LONG_DASH)).toBe(false);
        expect(spawnSync("/bin/sh", ["-n", f]).status).toBe(0);
        const sc = spawnSync("shellcheck", ["-s", "sh", f], {
          encoding: "utf8",
        });
        if (!sc.error) expect(sc.stdout).toBe("");
      }
    });

    describe("Node detection", () => {
      it("picks the newest Node in range under nvm and ignores v24 and v20", () => {
        nvm("22.16.0");
        nvm("22.22.2");
        nvm("24.21.0");
        nvm("20.11.0");
        expect(run(UPDATE).code).toBe(0);
        expect(called().find((l) => /^npm@.* ci /.test(l))).toContain(
          "/v22.22.2/bin",
        );
        expect(count(/^node@.*package\.mjs/)).toBe(1);
        expect(called()).toContain(
          "SELF_UPDATE=0 scripts/package.mjs --mac dir --publish never -c.mac.identity=- -c.mac.notarize=false -c.mac.hardenedRuntime=false",
        );
        expect(
          readFileSync(path.join(apps, "Cate.app/Contents/id"), "utf8"),
        ).toBe("new\n");
        expect(readFileSync(`${build}.installed`, "utf8").trim()).toBe(SHA);
      });

      it("finds Homebrew node@22", () => {
        addNode(path.join(root, "brew/opt/node@22/bin"), "v22.20.0");
        expect(run(UPDATE).code).toBe(0);
        expect(called().find((l) => /^npm@.* ci /.test(l))).toContain(
          "node@22/bin",
        );
      });

      it("finds a Node on the PATH", () => {
        addNode(fakes, "v22.30.1");
        expect(run(UPDATE).code).toBe(0);
        expect(count(/^npm@.* ci /)).toBe(1);
      });

      it("says what to install and touches nothing when Node is missing or too old", () => {
        nvm("20.11.0");
        expect(run(UPDATE).code).toBe(3);
        expect(log()).toMatch(
          /Node >=22\.16 <23 requis, trouvé v20\.11\.0 ; cherché : PATH, nvm, volta, fnm, homebrew\. Installer : brew install node@22/,
        );
        expect(count(/^npm@/)).toBe(0);
        expect(existsSync(path.join(apps, "Cate.app"))).toBe(false);
        run(UPDATE);
        expect(count(/^osascript@/)).toBe(1); // notified once for this version
        const prereq = run(UPDATE, ["--prereq"]);
        expect(prereq.code).toBe(5);
        expect(prereq.out).toMatch(
          /MANQUE Node >=22\.16 <23 requis, trouvé v20\.11\.0/,
        );
      });
    });

    describe("update", () => {
      it("does not install while Cate is open, then installs once it is closed without rebuilding", () => {
        nvm("22.22.2");
        mkdirSync(path.join(apps, "Cate.app"));
        writeFileSync(path.join(apps, "Cate.app/id"), "old");
        expect(run(UPDATE, [], { FAKE_CATE_OPEN: "1" }).code).toBe(0);
        expect(readFileSync(path.join(apps, "Cate.app/id"), "utf8")).toBe(
          "old",
        );
        expect(existsSync(`${build}.staged/Cate.app`)).toBe(true);
        expect(log()).toMatch(/Cate is open/);
        expect(called()).toContain(
          `pgrep@${fakes} -f Cate.app/Contents/MacOS/Cate`,
        );
        expect(run(UPDATE).code).toBe(0);
        expect(
          readFileSync(path.join(apps, "Cate.app/Contents/id"), "utf8"),
        ).toBe("new\n");
        expect(existsSync(path.join(apps, "Cate.app.old"))).toBe(false);
        expect(existsSync(`${build}.staged`)).toBe(false);
        expect(count(/^npm@.* ci /)).toBe(1);
        expect(count(/^xattr@.*com\.apple\.quarantine/)).toBe(1);
      });

      it("keeps the installed app, retries a failed build 3 times, then notifies once and stops", () => {
        nvm("22.22.2");
        mkdirSync(path.join(apps, "Cate.app"));
        writeFileSync(path.join(apps, "Cate.app/id"), "old");
        const before = tree(apps);
        for (let i = 0; i < 3; i++)
          expect(run(UPDATE, [], { FAKE_NPM_FAIL: "1" }).code).toBe(1);
        expect(run(UPDATE, [], { FAKE_NPM_FAIL: "1" }).code).toBe(0);
        expect(tree(apps)).toEqual(before);
        expect(count(/^npm@.* ci /)).toBe(3); // a 4th run does not build again
        expect(count(/^osascript@/)).toBe(1);
        expect(log()).toMatch(/failed 3 times.*--force/);
        expect(existsSync(`${build}.staged`)).toBe(false);
        expect(existsSync(`${build}.lock`)).toBe(false); // lock released after a failure
        expect(run(UPDATE, ["--force"], { FAKE_NPM_FAIL: "1" }).code).toBe(1);
        expect(count(/^npm@.* ci /)).toBe(4);
      });

      it("installs on the next run when the first build failed once (network cut)", () => {
        nvm("22.22.2");
        expect(run(UPDATE, [], { FAKE_NPM_FAIL: "1" }).code).toBe(1);
        expect(existsSync(path.join(apps, "Cate.app"))).toBe(false);
        expect(run(UPDATE).code).toBe(0);
        expect(
          readFileSync(path.join(apps, "Cate.app/Contents/id"), "utf8"),
        ).toBe("new\n");
        expect(existsSync(`${build}.failed`)).toBe(false);
        expect(count(/^osascript@.*/)).toBe(1); // only "installé", no failure notice
      });

      it("restores the old app and notifies once when the new one cannot be moved in", () => {
        nvm("22.22.2");
        const realMv = which("mv");
        fake(
          "mv",
          `case "$1" in *.staged/Cate.app) [ "\${FAKE_MV_FAIL:-0}" = 0 ] || exit 1 ;; esac\nexec "${realMv}" "$@"`,
        );
        mkdirSync(path.join(apps, "Cate.app"));
        writeFileSync(path.join(apps, "Cate.app/id"), "old");
        expect(run(UPDATE, [], { FAKE_MV_FAIL: "1" }).code).toBe(1);
        expect(readFileSync(path.join(apps, "Cate.app/id"), "utf8")).toBe(
          "old",
        );
        expect(existsSync(path.join(apps, "Cate.app.old"))).toBe(false);
        expect(log()).toMatch(/old app restored/);
        expect(run(UPDATE, [], { FAKE_MV_FAIL: "1" }).code).toBe(1);
        expect(count(/^osascript@/)).toBe(1);
        rmSync(path.join(apps, "Cate.app"), { recursive: true });
        expect(run(UPDATE, [], { FAKE_MV_FAIL: "1" }).code).toBe(1);
        expect(log()).toMatch(/there was no old app/);
        expect(existsSync(path.join(apps, "Cate.app"))).toBe(false);
        expect(run(UPDATE).code).toBe(0); // the staged build is installed later
        expect(
          readFileSync(path.join(apps, "Cate.app/Contents/id"), "utf8"),
        ).toBe("new\n");
        expect(count(/^npm@.* ci /)).toBe(1);
      });

      it("refreshes its own copy in ~/.local/bin from the built commit", () => {
        nvm("22.22.2");
        expect(run(INSTALL).code).toBe(0);
        const self = path.join(home, ".local/bin/cate-fork-update");
        const next = path.join(root, "next.sh");
        write(next, `${readFileSync(UPDATE, "utf8")}# v2\n`);
        expect(run(UPDATE, [], { FAKE_SHA: SHA2, FAKE_SELF: next }).code).toBe(0);
        expect(readFileSync(self, "utf8")).toBe(readFileSync(next, "utf8"));
        expect(statSync(self).mode & 0o777).toBe(0o755);
        expect(log()).toMatch(/cate-fork-update refreshed/);
        // A broken, empty or crashing copy is never installed: the one in place
        // must still be able to take the next fix.
        write(next, "if then\n");
        run(UPDATE, [], { FAKE_SHA: SHA2, FAKE_SELF: next });
        write(next, "");
        run(UPDATE, [], { FAKE_SHA: SHA2, FAKE_SELF: next });
        write(
          next,
          readFileSync(UPDATE, "utf8").replace("set -eu\n", 'set -eu\n: "$NOT_SET_AT_START"\n'),
        );
        expect(spawnSync("/bin/sh", ["-n", next]).status).toBe(0); // parses, crashes at start
        run(UPDATE, [], { FAKE_SHA: SHA2, FAKE_SELF: next });
        expect(log()).toMatch(/self-test failed, kept the installed copy/);
        expect(readFileSync(self, "utf8")).toMatch(/# v2\n$/);
        expect(readFileSync(UPDATE, "utf8")).not.toMatch(/# v2\n$/); // never the running copy
      });

      it("refuses to run when HOME is empty, / or not an absolute folder", () => {
        const outside = path.join(root, "x/cate-build");
        const keep = path.join(outside, "keep.txt");
        write(keep, "keep");
        for (const h of ["", "/", "//", "relative", path.join(root, "missing")]) {
          const r = run(UPDATE, ["--purge"], { HOME: h, CATE_BUILD_DIR: outside });
          expect([h, r.code]).toEqual([h, 1]);
          expect(r.out).toMatch(/HOME/);
        }
        expect(existsSync(keep)).toBe(true);
        mkdirSync(path.join(root, "relative"));
        for (const h of ["", "/", "relative", path.join(root, "missing")]) {
          const r = run(INSTALL, [], { HOME: h });
          expect([h, r.code]).toEqual([h, 1]);
          expect(r.out).toMatch(/HOME/);
        }
        expect(readdirSync(path.join(root, "relative"))).toEqual([]);
        expect(count(/^launchctl@|^git@|^npm@/)).toBe(0);
      });

      it("refuses to stage a hardened-runtime build, and survives a failed packaging step", () => {
        nvm("22.22.2");
        expect(run(UPDATE, [], { FAKE_HARDENED: "1" }).code).toBe(1);
        expect(log()).toMatch(/hardened runtime still on/);
        expect(existsSync(`${build}.staged`)).toBe(false);
        expect(existsSync(path.join(apps, "Cate.app"))).toBe(false);
        expect(run(UPDATE, ["--force"], { FAKE_PACKAGE_FAIL: "1" }).code).toBe(
          1,
        );
        expect(existsSync(path.join(apps, "Cate.app"))).toBe(false);
      });

      it("builds nothing twice for one commit, and builds the next one", () => {
        nvm("22.22.2");
        run(UPDATE);
        run(UPDATE);
        expect(count(/^npm@.* ci /)).toBe(1);
        run(UPDATE, [], { FAKE_SHA: SHA2 });
        expect(count(/^npm@.* ci /)).toBe(2);
        expect(readFileSync(`${build}.installed`, "utf8").trim()).toBe(SHA2);
      });

      it("waits on a live lock and replaces a dead one", () => {
        nvm("22.22.2");
        const live = liveRun();
        try {
          write(`${build}.lock/pid`, `${live.pid}\n`);
          expect(run(UPDATE).code).toBe(0);
          expect(log()).toMatch(/already running/);
          expect(count(/^git@/)).toBe(0);
        } finally {
          live.stop();
        }
        writeFileSync(`${build}.lock/pid`, "2147483646\n");
        expect(run(UPDATE).code).toBe(0);
        expect(count(/^npm@.* ci /)).toBe(1);
      });

      it("takes over a lock whose pid was reused by another program after a power cut", () => {
        nvm("22.22.2");
        write(`${build}.lock/pid`, `${process.pid}\n`); // alive, but node, not this script
        expect(run(UPDATE).code).toBe(0);
        expect(log()).not.toMatch(/already running/);
        expect(count(/^npm@.* ci /)).toBe(1);
        const tail = liveRun("cate-fork-update.log"); // like tail -f on the log
        try {
          write(`${build}.lock/pid`, `${tail.pid}\n`);
          expect(run(UPDATE, ["--force"]).code).toBe(0);
          expect(count(/^npm@.* ci /)).toBe(2);
        } finally {
          tail.stop();
        }
      });

      it("never purges under a running build, and purges once it is over", () => {
        nvm("22.22.2");
        run(UPDATE);
        const live = liveRun();
        try {
          write(`${build}.lock/pid`, `${live.pid}\n`);
          const r = run(UPDATE, ["--purge"]);
          expect(r.code).toBe(1);
          expect(r.out).toMatch(/construction en cours/);
          expect(existsSync(path.join(build, ".git"))).toBe(true);
          expect(existsSync(`${build}.installed`)).toBe(true);
        } finally {
          live.stop();
        }
        expect(run(UPDATE, ["--purge"]).code).toBe(0);
        for (const s of ["", ".lock", ".installed"])
          expect(existsSync(`${build}${s}`)).toBe(false);
      });

      it("keeps every state file outside the clone, even with a trailing slash", () => {
        for (const dir of [`${build}/`, `${build}//`, "~/.local/share/cate-build/"]) {
          rmSync(root + "/home/.local", { recursive: true, force: true });
          const bin = path.join(home, ".nvm/versions/node/v22.22.2/bin");
          nvm("22.22.2");
          const probe = path.join(root, "probe.txt");
          // npm ci runs in the clone while the lock is held: list both.
          fake(
            "npm",
            `[ "$1" != ci ] || { ls -A > "${probe}"; [ ! -d "${build}.lock" ] || echo LOCK-HELD >> "${probe}"; }`,
            bin,
          );
          expect([dir, run(UPDATE, [], { CATE_BUILD_DIR: dir }).code]).toEqual([dir, 0]);
          const seen = readFileSync(probe, "utf8").split("\n");
          expect(seen).toContain("LOCK-HELD");
          for (const s of [".lock", ".staged", ".notified", ".installed", ".failed"]) {
            expect([dir, s, seen.includes(s)]).toEqual([dir, s, false]);
            expect(existsSync(path.join(build, s))).toBe(false);
          }
          expect(readFileSync(`${build}.installed`, "utf8").trim()).toBe(SHA);
        }
      });

      it("--self-test exits 0 and touches nothing", () => {
        const r = run(UPDATE, ["--self-test"]);
        expect([r.code, r.out]).toEqual([0, ""]);
        expect(readdirSync(home)).toEqual([]);
        expect(count(/^git@|^npm@|^launchctl@|^osascript@/)).toBe(0);
      });

      it("refuses to run as root, in update and install", () => {
        nvm("22.22.2");
        const realId = which("id");
        fake("id", `[ -z "\${FAKE_UID:-}" ] || { echo "$FAKE_UID"; exit 0; }\nexec "${realId}" "$@"`);
        for (const s of [UPDATE, INSTALL]) {
          const r = run(s, [], { FAKE_UID: "0" });
          expect([s, r.code]).toEqual([s, 1]);
          expect(r.out).toMatch(/root/);
        }
        expect(readdirSync(home)).toEqual([".nvm"]);
        expect(count(/^git@|^npm@|^launchctl@/)).toBe(0);
      });

      it("stops under 5 GB free, outside macOS, and without developer tools", () => {
        nvm("22.22.2");
        expect(run(UPDATE, [], { FAKE_DF_KB: "1000" }).code).toBe(4);
        expect(count(/^npm@.* ci /)).toBe(0);
        expect(run(UPDATE, [], { FAKE_UNAME: "Linux" }).code).toBe(2);
        writeFileSync(calls, "");
        expect(run(UPDATE, [], { FAKE_NO_CLT: "1" }).code).toBe(5);
        expect(count(/^git@/)).toBe(0); // git never runs without the developer tools
      });

      it("reads repo, branch and build folder from the conf file, never as code", () => {
        nvm("22.22.2");
        write(
          path.join(home, ".config/cate-fork-update.conf"),
          "CATE_FORK_REPO=https://example.test/fork.git\nCATE_FORK_BRANCH=dev\nCATE_BUILD_DIR=~/alt/cate-build\n# comment\nPATH=/evil\n",
        );
        expect(run(UPDATE, [], { CATE_BUILD_DIR: "" }).code).toBe(0);
        expect(called()).toContain(
          `git@${fakes} clone -q https://example.test/fork.git ${home}/alt/cate-build`,
        );
        expect(called()).toContain(`git@${fakes} fetch -q origin dev`);
        expect(existsSync(path.join(home, "alt/cate-build.installed"))).toBe(
          true,
        );
      });

      it("reads the last conf line even without a final newline", () => {
        nvm("22.22.2");
        write(
          path.join(home, ".config/cate-fork-update.conf"),
          "# hand edited\nCATE_FORK_BRANCH=dev",
        );
        expect(run(UPDATE).code).toBe(0);
        expect(called()).toContain(`git@${fakes} fetch -q origin dev`);
      });

      it("builds a pinned tag or commit from FETCH_HEAD, and refuses a ref that looks like an option", () => {
        nvm("22.22.2");
        expect(run(UPDATE, [], { CATE_FORK_BRANCH: "v1.2.0" }).code).toBe(0);
        expect(called()).toContain(`git@${fakes} fetch -q origin v1.2.0`);
        expect(called().some((l) => /rev-parse FETCH_HEAD/.test(l))).toBe(true);
        writeFileSync(calls, "");
        expect(
          run(UPDATE, [], { CATE_FORK_BRANCH: "--upload-pack=x" }).code,
        ).toBe(64);
        expect(
          run(UPDATE, [], { CATE_FORK_REPO: "--upload-pack=x" }).code,
        ).toBe(64);
        expect(count(/^git@/)).toBe(0);
      });

      it("restores the old app when a cut left Cate.app.old and no Cate.app", () => {
        mkdirSync(path.join(apps, "Cate.app.old"));
        writeFileSync(path.join(apps, "Cate.app.old/id"), "old");
        run(UPDATE); // no Node: stops after the restore
        expect(readFileSync(path.join(apps, "Cate.app/id"), "utf8")).toBe(
          "old",
        );
        expect(existsSync(path.join(apps, "Cate.app.old"))).toBe(false);
        expect(log()).toMatch(/restored/);
      });

      it("stops before building when the install folder is not writable", (ctx) => {
        if (process.getuid?.() === 0) return ctx.skip();
        nvm("22.22.2");
        chmodSync(apps, 0o555);
        try {
          const r = run(UPDATE);
          expect(r.code).toBe(5);
          expect(log()).toMatch(
            /non inscriptible.*CATE_APPS_DIR=~\/Applications/,
          );
          expect(count(/^npm@/)).toBe(0);
          expect(run(UPDATE, ["--prereq"]).out).toMatch(
            /MANQUE dossier d'installation/,
          );
        } finally {
          chmodSync(apps, 0o755);
        }
      });

      it("takes over a lock without pid only after 15 minutes", () => {
        nvm("22.22.2");
        mkdirSync(`${build}.lock`, { recursive: true });
        expect(run(UPDATE).code).toBe(0);
        expect(log()).toMatch(/already running/);
        const old = new Date(Date.now() - 20 * 60 * 1000);
        utimesSync(`${build}.lock`, old, old);
        expect(run(UPDATE).code).toBe(0);
        expect(count(/^npm@.* ci /)).toBe(1);
      });

      it("lets one of two concurrent runs win a dead lock", async () => {
        nvm("22.22.2");
        write(`${build}.lock/pid`, "2147483646\n");
        await Promise.all([runAsync(UPDATE), runAsync(UPDATE)]);
        expect(count(/^npm@.* ci /)).toBe(1);
        expect(readFileSync(`${build}.installed`, "utf8").trim()).toBe(SHA);
      });

      it("rotates a log over 1 MB", () => {
        nvm("22.22.2");
        write(
          path.join(home, "Library/Logs/cate-fork-update.log"),
          "x".repeat(1100000),
        );
        run(UPDATE);
        expect(
          readFileSync(
            path.join(home, "Library/Logs/cate-fork-update.log.1"),
            "utf8",
          ).length,
        ).toBe(1100000);
        expect(log().length).toBeLessThan(100000);
      });
    });

    describe("build folder safety", () => {
      const sentinel = (dir) => {
        write(path.join(dir, "keep.txt"), "keep");
        return path.join(dir, "keep.txt");
      };

      it("refuses every folder that is not a clone named cate-build under HOME", () => {
        const other = path.join(home, "other");
        const link = path.join(home, ".local/share/cate-build");
        const keeps = [
          sentinel(home),
          sentinel(path.join(home, "Documents")),
          sentinel(other),
        ];
        mkdirSync(path.dirname(link), { recursive: true });
        symlinkSync(other, link);
        const cases = [
          home,
          `${home}/`,
          "~",
          "~/",
          "~/Documents",
          `${home}/Documents/cate-build/..`,
          `${home}/x/../cate-build`,
          "cate-build",
          link,
          "/Users",
          "/Applications",
          "/",
        ];
        for (const value of cases) {
          for (const mode of ["--purge", "--prereq"]) {
            // /Users, /Applications and / are only probed in read-only mode.
            if (mode === "--purge" && /^\/(Users|Applications)?$/.test(value))
              continue;
            const r = run(UPDATE, [mode], { CATE_BUILD_DIR: value });
            expect([value, mode, r.code]).toEqual([value, mode, 6]);
            expect(r.out).toMatch(/dossier de build refusé/);
          }
        }
        for (const k of keeps) expect(existsSync(k)).toBe(true);
        expect(count(/^git@/)).toBe(0);
      });

      it("takes an empty value as the default folder, and purges only that", () => {
        const keep = sentinel(home);
        sentinel(build);
        expect(run(UPDATE, ["--purge"], { CATE_BUILD_DIR: "" }).code).toBe(0);
        expect(existsSync(build)).toBe(false);
        expect(existsSync(keep)).toBe(true);
      });

      it("never purges HOME through uninstall, even with CATE_BUILD_DIR=~/ in the conf", () => {
        nvm("22.22.2");
        run(INSTALL);
        const keep = sentinel(home);
        write(
          path.join(home, ".config/cate-fork-update.conf"),
          "CATE_BUILD_DIR=~/\n",
        );
        const r = run(UNINSTALL, ["--purge"], { CATE_BUILD_DIR: "" });
        expect(r.code).toBe(1);
        expect(r.out).toMatch(/dossier de build refusé/);
        expect(existsSync(keep)).toBe(true);
        expect(existsSync(path.join(home, ".nvm"))).toBe(true);
        expect(
          existsSync(
            path.join(home, "Library/LaunchAgents/com.cate.fork-update.plist"),
          ),
        ).toBe(false); // the agent is still removed
      });

      it.skipIf(!realGit)(
        "refuses a real repository whose origin is another one, and its ignored files survive",
        () => {
          nvm("22.22.2");
          makeRepo(build, "https://example.test/mine.git");
          const env = { REAL_GIT: realGit };
          for (const args of [[], ["--purge"], ["--force"]]) {
            const r = run(UPDATE, args, env);
            expect(r.code).toBe(6);
            expect(r.out + log()).toMatch(/origin/);
          }
          expect(existsSync(path.join(build, ".env"))).toBe(true);
          expect(count(/^git@.* (clean|checkout)/)).toBe(0);
          expect(count(/^npm@/)).toBe(0);
        },
      );
    });

    describe("install and uninstall", () => {
      const plist = () =>
        path.join(home, "Library/LaunchAgents/com.cate.fork-update.plist");

      it("writes absolute paths, boots out then bootstraps, and builds", () => {
        nvm("22.22.2");
        const r = run(INSTALL);
        expect(r.code).toBe(0);
        const p = readFileSync(plist(), "utf8");
        expect(p).toContain(
          "<key>Label</key><string>com.cate.fork-update</string>",
        );
        expect(p).toContain(
          `<string>${home}/.local/bin/cate-fork-update</string>`,
        );
        expect(p).toContain(
          `<string>${home}/Library/Logs/cate-fork-update.log</string>`,
        );
        expect(p).toContain("<key>StartInterval</key><integer>600</integer>");
        // No run at load: the agent's first run comes 10 minutes after the
        // foreground build started, and waits on its lock instead of racing it.
        expect(p).not.toContain("RunAtLoad");
        expect(p).not.toContain("~");
        expect(p).not.toContain(os.homedir());
        expect(called().filter((l) => /^launchctl@/.test(l))).toEqual([
          `launchctl@${fakes} bootout gui/${uid()}/com.cate.fork-update`,
          `launchctl@${fakes} bootstrap gui/${uid()} ${plist()}`,
        ]);
        // Loaded before the long build: a Terminal closed meanwhile still leaves the agent.
        const order = called().filter((l) => /^launchctl@.* bootstrap |^npm@.* ci /.test(l));
        expect(order.map((l) => l.split("@")[0])).toEqual(["launchctl", "npm"]);
        expect(
          readFileSync(path.join(apps, "Cate.app/Contents/id"), "utf8"),
        ).toBe("new\n");
        const last3 = r.out.trim().split("\n").slice(-3);
        expect(last3.map((l) => l.split(" ")[0])).toEqual([
          "Fait",
          "Journal",
          "Désinstaller",
        ]);
        expect(existsSync(path.join(home, ".local/bin/cate-fork-update"))).toBe(
          true,
        );
      });

      it("twice in a row gives the same state, without a second build or a duplicate", () => {
        nvm("22.22.2");
        run(INSTALL);
        const first = tree(home);
        expect(run(INSTALL).code).toBe(0);
        expect(tree(home)).toEqual(first);
        expect(count(/^npm@.* ci /)).toBe(1);
        expect(count(/^launchctl@.* bootout /)).toBe(2); // each run unloads before it loads
        expect(count(/^launchctl@.* bootstrap /)).toBe(2);
        expect(readdirSync(path.join(home, "Library/LaunchAgents"))).toEqual([
          "com.cate.fork-update.plist",
        ]);
      });

      it("does not duplicate an agent that already runs cate-fork-update under another label", () => {
        nvm("22.22.2");
        write(
          path.join(
            home,
            "Library/LaunchAgents/com.example.cate-fork-update.plist",
          ),
          `<string>${home}/.local/bin/cate-fork-update</string>`,
        );
        const r = run(INSTALL);
        expect(r.code).toBe(0);
        expect(r.out).toMatch(/lance déjà cate-fork-update/);
        expect(existsSync(plist())).toBe(false);
        expect(existsSync(path.join(home, ".local"))).toBe(false);
        expect(count(/^launchctl@|^git@|^npm@/)).toBe(0);
      });

      it("--branche pins the branch, tag or commit for the agent and the first build", () => {
        nvm("22.22.2");
        write(
          path.join(home, ".config/cate-fork-update.conf"),
          "CATE_FORK_REPO=https://github.com/Heifarabuval/cate.git\n",
        );
        expect(run(INSTALL, ["--branche", "v1.2.0"]).code).toBe(0);
        const conf = readFileSync(
          path.join(home, ".config/cate-fork-update.conf"),
          "utf8",
        );
        expect(conf).toContain("CATE_FORK_BRANCH=v1.2.0");
        expect(conf).toContain(
          "CATE_FORK_REPO=https://github.com/Heifarabuval/cate.git",
        );
        expect(called()).toContain(`git@${fakes} fetch -q origin v1.2.0`);
        expect(run(INSTALL, ["--branche"]).code).toBe(64);
        expect(run(INSTALL, ["--branche", "--x"]).code).toBe(64);
      });

      it("keeps the agent loaded when the first build fails, and says it retries", () => {
        nvm("22.22.2");
        const r = run(INSTALL, [], { FAKE_NPM_FAIL: "1" });
        expect(r.code).toBe(1);
        expect(r.out).toMatch(/première construction a échoué/);
        expect(r.out).toMatch(/réessaie.*--force/);
        expect(existsSync(plist())).toBe(true);
        expect(count(/^launchctl@.* bootstrap /)).toBe(1);
        expect(existsSync(path.join(apps, "Cate.app"))).toBe(false);
      });

      it("stops before writing anything when the download fails", () => {
        nvm("22.22.2");
        const r = run(INSTALL, [], { FAKE_CURL_FAIL: "1" }, readFileSync(INSTALL, "utf8"));
        expect(r.code).toBe(1);
        expect(r.out).toMatch(/téléchargement impossible/);
        expect(existsSync(path.join(home, ".local"))).toBe(false);
        expect(existsSync(path.join(home, "Library"))).toBe(false);
        expect(count(/^launchctl@|^git@|^npm@/)).toBe(0);
      });

      it("--sans-launchd writes no agent and loads nothing", () => {
        nvm("22.22.2");
        expect(run(INSTALL, ["--sans-launchd"]).code).toBe(0);
        expect(existsSync(plist())).toBe(false);
        expect(count(/^launchctl@/)).toBe(0);
        expect(existsSync(path.join(home, ".local/bin/cate-fork-update"))).toBe(
          true,
        );
      });

      it("names every missing prerequisite at once and installs nothing", () => {
        const r = run(INSTALL, [], { FAKE_NO_CLT: "1" });
        expect(r.code).toBe(5);
        expect(r.out).toMatch(
          /MANQUE outils développeur : lancer xcode-select --install/,
        );
        expect(r.out).toMatch(/MANQUE Node >=22\.16 <23 requis, trouvé aucun/);
        expect(existsSync(path.join(home, ".local"))).toBe(false);
        expect(count(/^git@|^launchctl@/)).toBe(0);
        expect(run(INSTALL, [], { FAKE_NO_NET: "1" }).out).toMatch(
          /MANQUE connexion/,
        );
      });

      it("runs piped to sh by downloading the update script; a truncated copy does nothing", () => {
        nvm("22.22.2");
        const text = readFileSync(INSTALL, "utf8");
        expect(run(INSTALL, [], {}, text).code).toBe(0);
        expect(
          called().some((l) =>
            /^curl@.* --proto =https --tlsv1\.2 -fsSL -o .*cate-fork-update\.sh https:\/\/raw\.example\.test\/scripts\/cate-fork-update\.sh$/.test(
              l,
            ),
          ),
        ).toBe(true);
        expect(existsSync(path.join(home, ".local/bin/cate-fork-update"))).toBe(
          true,
        );
        rmSync(path.join(home, ".local"), { recursive: true });
        rmSync(path.join(home, "Library"), { recursive: true });
        writeFileSync(calls, "");
        run(INSTALL, [], {}, text.slice(0, Math.floor(text.length / 2)));
        expect(called()).toEqual([]);
        expect(existsSync(path.join(home, ".local"))).toBe(false);
      });

      it("uninstalls the agent and the script, keeps the app, --purge also drops the build folder", () => {
        nvm("22.22.2");
        run(INSTALL);
        expect(run(UNINSTALL).code).toBe(0);
        expect(existsSync(plist())).toBe(false);
        expect(existsSync(path.join(home, ".local/bin/cate-fork-update"))).toBe(
          false,
        );
        expect(existsSync(path.join(build, ".git"))).toBe(true);
        expect(count(/^launchctl@.* bootout /)).toBe(2);
        expect(run(UNINSTALL).code).toBe(0); // nothing left to undo
        run(INSTALL);
        expect(run(UNINSTALL, ["--purge"]).code).toBe(0);
        expect(existsSync(build)).toBe(false);
        expect(existsSync(`${build}.installed`)).toBe(false);
        expect(
          readFileSync(path.join(apps, "Cate.app/Contents/id"), "utf8"),
        ).toBe("new\n");
      });
    });
  },
);
