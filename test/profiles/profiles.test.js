import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { evalConfig } from "../../eval/run.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const profilesDir = path.join(root, "opencode", "profiles");

const SECRET_READ = [
  "~/.ssh/*",
  "~/.gnupg/*",
  "~/.aws/*",
  "~/.config/gh/*",
  "~/.config/gcloud/*",
  "~/.azure/*",
  "~/.kube/*",
  "~/.docker/*",
  "~/.npmrc",
  "~/.netrc",
  "*.pem",
  "*.key",
  "*.env",
  "*.env.*",
];

const SECRET_EXTERNAL = [
  "~/.ssh/*",
  "~/.gnupg/*",
  "~/.aws/*",
  "~/.config/gh/*",
  "~/.config/gcloud/*",
  "~/.azure/*",
  "~/.kube/*",
  "~/.docker/*",
];

const SHELL_DENY = [
  "sudo *",
  "rm *",
  "curl * | bash",
  "curl * | sh",
  "wget * | bash",
  "wget * | sh",
  "git push *",
  "eval *",
];

const SUDO_ALLOWLIST = [
  "sudo apt-get *",
  "sudo apt *",
  "sudo systemctl *",
  "sudo sysctl *",
  "sudo install *",
];

function loadProfile(name) {
  return JSON.parse(
    fs.readFileSync(path.join(profilesDir, `${name}.json`), "utf8"),
  );
}

function hasRule(config, action, resource, effect) {
  return config.permissions.some(
    (r) =>
      r.action === action && r.resource === resource && r.effect === effect,
  );
}

function ruleIndex(config, action, resource) {
  let idx = -1;
  config.permissions.forEach((r, i) => {
    if (r.action === action && r.resource === resource) idx = i;
  });
  return idx;
}

function assertNeverList(config, label) {
  for (const resource of SECRET_READ) {
    assert.ok(
      hasRule(config, "read", resource, "deny"),
      `${label}: read deny missing for ${resource}`,
    );
  }
  for (const resource of SECRET_EXTERNAL) {
    assert.ok(
      hasRule(config, "external_directory", resource, "deny"),
      `${label}: external_directory deny missing for ${resource}`,
    );
  }
  for (const resource of SHELL_DENY) {
    assert.ok(
      hasRule(config, "shell", resource, "deny"),
      `${label}: shell deny missing for ${resource}`,
    );
  }
}

test("profiles parse and every rule is well-formed", () => {
  for (const name of ["explore", "feature", "infra"]) {
    const profile = loadProfile(name);
    assert.equal(profile.$schema, "https://opencode.ai/config.json");
    assert.ok(Array.isArray(profile.permissions));
    assert.ok(profile.permissions.length > 0);
    for (const rule of profile.permissions) {
      assert.equal(typeof rule.action, "string");
      assert.equal(typeof rule.resource, "string");
      assert.ok(["allow", "deny", "ask"].includes(rule.effect));
    }
  }
});

test("every profile carries the full never-list", () => {
  for (const name of ["explore", "feature", "infra"]) {
    assertNeverList(loadProfile(name), name);
  }
});

test("no profile allows shell broadly", () => {
  for (const name of ["explore", "feature", "infra"]) {
    const profile = loadProfile(name);
    assert.ok(
      !hasRule(profile, "shell", "*", "allow"),
      `${name}: blanket shell allow would void the never-list`,
    );
  }
});

test("never-list denies come after the broad rules they override", () => {
  for (const name of ["explore", "feature", "infra"]) {
    const profile = loadProfile(name);
    const broadShell = ruleIndex(profile, "shell", "*");
    assert.ok(broadShell >= 0, `${name}: no broad shell rule`);
    for (const resource of SHELL_DENY) {
      assert.ok(
        ruleIndex(profile, "shell", resource) > broadShell,
        `${name}: shell deny for ${resource} must come after the broad rule`,
      );
    }
    const broadEdit = ruleIndex(profile, "edit", "*");
    if (broadEdit >= 0) {
      for (const resource of SECRET_READ) {
        const idx = ruleIndex(profile, "edit", resource);
        if (idx >= 0) {
          assert.ok(
            idx > broadEdit,
            `${name}: edit deny for ${resource} must come after the broad rule`,
          );
        }
      }
    }
  }
});

test("*.env.example stays allowed after the *.env denies", () => {
  for (const name of ["explore", "feature", "infra"]) {
    const profile = loadProfile(name);
    assert.ok(
      hasRule(profile, "read", "*.env.example", "allow"),
      `${name}: *.env.example allow missing`,
    );
    assert.ok(
      ruleIndex(profile, "read", "*.env.example") >
        ruleIndex(profile, "read", "*.env.*"),
      `${name}: *.env.example allow must come after the *.env.* deny`,
    );
  }
  for (const name of ["feature", "infra"]) {
    const profile = loadProfile(name);
    assert.ok(
      ruleIndex(profile, "edit", "*.env.example") >
        ruleIndex(profile, "edit", "*.env.*"),
      `${name}: edit *.env.example allow must come after the *.env.* deny`,
    );
  }
});

test("explore is read-only, feature and infra allow edits on ask", () => {
  assert.ok(hasRule(loadProfile("explore"), "edit", "*", "deny"));
  assert.ok(hasRule(loadProfile("feature"), "edit", "*", "ask"));
  assert.ok(hasRule(loadProfile("infra"), "edit", "*", "ask"));
});

test("only infra has a sudo allowlist, and it is narrow", () => {
  for (const name of ["explore", "feature"]) {
    const profile = loadProfile(name);
    for (const resource of SUDO_ALLOWLIST) {
      assert.ok(
        !hasRule(profile, "shell", resource, "allow"),
        `${name}: must not allow ${resource}`,
      );
    }
  }
  const infra = loadProfile("infra");
  for (const resource of SUDO_ALLOWLIST) {
    assert.ok(
      hasRule(infra, "shell", resource, "allow"),
      `infra: missing sudo allow for ${resource}`,
    );
    assert.ok(
      ruleIndex(infra, "shell", resource) > ruleIndex(infra, "shell", "sudo *"),
      `infra: ${resource} allow must come after the sudo * deny`,
    );
  }
  const sudoAllows = infra.permissions.filter(
    (r) =>
      r.action === "shell" &&
      r.effect === "allow" &&
      r.resource.startsWith("sudo "),
  );
  assert.deepEqual(
    sudoAllows.map((r) => r.resource).sort(),
    [...SUDO_ALLOWLIST].sort(),
  );
});

test("global config carries the secret denies and the policies hard-deny", () => {
  const global = JSON.parse(
    fs.readFileSync(path.join(root, "opencode", "opencode.json"), "utf8"),
  );
  assertNeverList(global, "global");
  assert.ok(Array.isArray(global.policies));
  assert.ok(global.policies.length > 0);
  for (const resource of SHELL_DENY) {
    assert.ok(
      global.policies.some(
        (p) =>
          p.action === "tool.use" &&
          p.resource === `shell:${resource}` &&
          p.effect === "deny",
      ),
      `global: policy hard-deny missing for shell:${resource}`,
    );
  }
});

test("eval runner config carries the never-list", () => {
  const config = evalConfig("ollama/qwen3:4b");
  assertNeverList(config, "eval");
});

test("workflow skill points at the profiles", () => {
  const skill = fs.readFileSync(
    path.join(root, "opencode", "skills", "workflow", "SKILL.md"),
    "utf8",
  );
  for (const name of ["explore", "feature", "infra"]) {
    assert.ok(
      skill.includes(`profiles/${name}.json`),
      `SKILL.md must reference profiles/${name}.json`,
    );
  }
  assert.ok(skill.includes("docs/threat-model.md"));
});
