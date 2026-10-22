---
name: grill-me
description: A user-invoked interview to sharpen an idea, decision, or design. Load only when the user invokes /grill-me or explicitly asks to be grilled.
license: MIT
metadata:
  opencode/autoinvoke: "false"
---

# Grill me

Load the `grilling` skill using the skill tool, then follow its interview
workflow for the user's idea. If no idea is supplied, ask what they want
to explore before starting.

Keep this session stateless: do not write files, generate a plan document,
create a workspace, or begin implementation. The goal is shared understanding,
not an artifact. The subject need not be software and no repository is required.

If a question needs a prototype or experiment rather than more discussion,
identify that limitation and ask whether the user wants to pause the interview
to investigate. Do not silently switch into building.

Adapted from [Matt Pocock's grill-me skill](https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/productivity/grill-me/SKILL.md)
at commit `5beb35b040e3de97e54fa9e386d7e42d15c295c2`.
See [LICENSE](LICENSE) for the upstream MIT license.
