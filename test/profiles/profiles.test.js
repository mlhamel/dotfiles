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
  "eval *",
];

const PUSH_DENY = [
  "git push --force*",
  "git push * --force*",
  "git push -f *",
  "git push * -f *",
  "git push --delete *",
  "git push * --delete *",
  "git push -d *",
  "git push * -d *",
  "git push * :*",
  "git push * master *",
  "git push * main *",
  "git push * HEAD:master *",
  "git push * HEAD:main *",
  "git push * :master *",
  "git push * :main *",
  "git push --all *",
  "git push * --all *",
  "git push --mirror *",
  "git push * --mirror *",
  "git push * +*",
  "git push +*",
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

function loadGlobal() {
  return JSON.parse(
    fs.readFileSync(path.join(root, "opencode", "opencode.json"), "utf8"),
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

function assertSecretDenies(config, label) {
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
}

function assertShellBaseDenies(config, label) {
  for (const resource of SHELL_DENY) {
    assert.ok(
      hasRule(config, "shell", resource, "deny"),
      `${label}: shell deny missing for ${resource}`,
    );
  }
}

function assertPushTargetedDenies(config, label) {
  for (const resource of PUSH_DENY) {
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

test("every profile carries the secret denies and the base shell denies", () => {
  for (const name of ["explore", "feature", "infra"]) {
    const profile = loadProfile(name);
    assertSecretDenies(profile, name);
    assertShellBaseDenies(profile, name);
  }
});

test("feature and infra allow branch pushes but deny the dangerous shapes", () => {
  for (const name of ["feature", "infra"]) {
    const profile = loadProfile(name);
    assertPushTargetedDenies(profile, name);
    assert.ok(
      !hasRule(profile, "shell", "git push *", "deny"),
      `${name}: blanket git push deny would block the factory flow`,
    );
  }
});

test("explore denies every push", () => {
  assert.ok(hasRule(loadProfile("explore"), "shell", "git push *", "deny"));
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

test("global config carries the secret denies, the targeted push denies, and the policies hard-deny", () => {
  const global = loadGlobal();
  assertSecretDenies(global, "global");
  assertShellBaseDenies(global, "global");
  assertPushTargetedDenies(global, "global");
  assert.ok(
    !hasRule(global, "shell", "git push *", "deny"),
    "global: blanket git push deny would block the factory flow",
  );
  assert.ok(Array.isArray(global.policies));
  assert.ok(global.policies.length > 0);
  for (const resource of [...SHELL_DENY, ...PUSH_DENY]) {
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
  assert.ok(
    !global.policies.some(
      (p) => p.action === "tool.use" && p.resource === "shell:git push *",
    ),
    "global: blanket git push policy would block the factory flow",
  );
});

test("never-list denies come after the broad rules they override", () => {
  const cases = [
    {
      config: loadProfile("explore"),
      label: "explore",
      denies: [...SHELL_DENY, "git push *"],
    },
    {
      config: loadProfile("feature"),
      label: "feature",
      denies: [...SHELL_DENY, ...PUSH_DENY],
    },
    {
      config: loadProfile("infra"),
      label: "infra",
      denies: [...SHELL_DENY, ...PUSH_DENY],
    },
    {
      config: loadGlobal(),
      label: "global",
      denies: [...SHELL_DENY, ...PUSH_DENY],
    },
  ];
  for (const { config, label, denies } of cases) {
    const broadShell = ruleIndex(config, "shell", "*");
    assert.ok(broadShell >= 0, `${label}: no broad shell rule`);
    for (const resource of denies) {
      assert.ok(
        ruleIndex(config, "shell", resource) > broadShell,
        `${label}: shell deny for ${resource} must come after the broad rule`,
      );
    }
    const broadEdit = ruleIndex(config, "edit", "*");
    if (broadEdit >= 0) {
      for (const resource of SECRET_READ) {
        const idx = ruleIndex(config, "edit", resource);
        if (idx >= 0) {
          assert.ok(
            idx > broadEdit,
            `${label}: edit deny for ${resource} must come after the broad rule`,
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

test("eval runner config carries the never-list", () => {
  const config = evalConfig("ollama/qwen3:4b");
  assertSecretDenies(config, "eval");
  assertShellBaseDenies(config, "eval");
  assert.ok(hasRule(config, "shell", "git push *", "deny"));
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

const agentsDir = path.join(root, "opencode", "agents");

function loadAgentSource(name) {
  return fs.readFileSync(path.join(agentsDir, `${name}.md`), "utf8");
}

function loadAgentFrontmatter(name) {
  const match = loadAgentSource(name).match(/^---\n([\s\S]*?)\n---/);
  assert.ok(match, `${name}.md: frontmatter block missing`);
  const meta = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^([a-z_]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return meta;
}

test("mode agents declare a description, a selectable mode and a model", () => {
  for (const name of ["ask", "ask-local", "plan", "review"]) {
    const meta = loadAgentFrontmatter(name);
    assert.ok(
      (meta.description || "").length > 10,
      `${name}: description missing or too short`,
    );
    assert.ok(
      ["primary", "all"].includes(meta.mode),
      `${name}: mode ${meta.mode} won't show in the canvas mode select`,
    );
    assert.match(meta.model || "", /^ollama\//, `${name}: model not pinned`);
  }
});

test("read-only mode agents deny edit and bash", () => {
  for (const name of ["ask", "ask-local", "plan", "review"]) {
    const raw = loadAgentSource(name);
    assert.match(raw, /edit:\s*deny/, `${name}: edit deny missing`);
    assert.ok(
      /bash:\s*deny/.test(raw) || raw.includes('"*": deny'),
      `${name}: bash deny missing`,
    );
  }
  assert.match(
    loadAgentSource("plan"),
    /webfetch:\s*deny/,
    "plan: webfetch deny missing",
  );
});

test("review keeps its git-only bash allowlist", () => {
  const raw = loadAgentSource("review");
  for (const rule of [
    '"*": deny',
    '"git diff*": allow',
    '"git log*": allow',
    '"git show*": allow',
  ]) {
    assert.ok(raw.includes(rule), `review: bash rule missing ${rule}`);
  }
});

test("plan pins the flash model used for the ACP preset", () => {
  const meta = loadAgentFrontmatter("plan");
  assert.equal(meta.model, "ollama/glm-5.3-flash:cloud");
});
