---
name: safety-ssh
description: >-
  Use whenever the user wants to reach a remote machine over SSH — "ssh into the
  lab box", "run this on the server", "check the remote logs", "deploy to prod",
  "connect to the jump host", or anything touching a remote host, network device,
  or PLC, especially from Claude Code on Windows/PowerShell. Establishes
  credential-free SSH: Claude only ever uses a host ALIAS and never sees or types
  passwords, usernames, hostnames, IP addresses, or key files. Trigger even when
  the user just pastes a raw `ssh user@10.x.x.x` command or mentions stored
  credentials, sshpass, or a password in .env — those are exactly the unsafe
  patterns this skill replaces.
---

# Safety SSH

Run remote commands over SSH **without the agent ever handling secrets, hostnames,
or IPs.** This exists because automated SSH from an AI tool that carries stored
credentials and pokes at raw IP ranges looks exactly like an intrusion to a
security team — and on operational-technology (OT) networks it can be genuinely
dangerous. The fix is to move every secret and every address *out* of anything
Claude can read, log, or echo, and leave Claude only a harmless **alias**.

## The one rule that makes this safe

**Claude only ever references a host by its alias** (e.g. `plcsim-lab`). The real
IP, hostname, username, port, and key path live in an admin-owned `~/.ssh/config`
that Claude does not read or edit. The decrypted key lives in `ssh-agent`, out of
reach. So the worst thing that can land in a transcript, a log, or a tool call is
the word `plcsim-lab` — never a credential or an address.

If you ever find yourself about to type an IP, a username, a password, or a path
to a key, **stop** — that is the failure mode this skill prevents.

## Workflow

Always go through the bundled scripts — they are deterministic, so the safe path
does not depend on Claude remembering flags.

1. **Preflight — verify the setup for the alias.** Run:
   - bash/macOS/Linux: `scripts/check-setup.sh <alias>`
   - Windows/PowerShell: `scripts/check-setup.ps1 <alias>`

   It checks (read-only, exposes no secrets) that ssh-agent has a key loaded, the
   alias is defined in `~/.ssh/config`, the alias is in the human-approved
   allowlist, key auth is configured, and a fail-fast connection actually works.
   If it prints `RESULT: not ready`, **do not improvise a workaround** — hand the
   user the one-time setup step below and stop.

2. **Run commands only through the wrapper:**
   - bash: `scripts/safe-ssh.sh <alias> -- <command...>`
   - PowerShell: `scripts/safe-ssh.ps1 <alias> <command...>`

   The wrapper refuses any alias not in the allowlist, rejects arguments that try
   to inject ssh options, and always uses `BatchMode=yes` so a missing key fails
   immediately instead of silently waiting on a hidden password prompt.

3. **Read first, change nothing by default.** Treat remote access as read-only
   unless the user has explicitly authorized a change for this specific host.

## One-time setup (a human does this, not Claude)

Key generation and the SSH config involve the passphrase and the real address, so
a human runs this once per host — Claude must not. Point the user at:

- bash: `scripts/setup-host.sh`
- PowerShell: `scripts/setup-host.ps1`

It generates an ed25519 key **with a passphrase**, loads it into `ssh-agent`,
writes a `Host <alias>` block to `~/.ssh/config`, and adds the alias to the
allowlist (`~/.ssh/claude-allowed-hosts`). Adding an alias to that file is the
deliberate human act of authorization — including for any sensitive host.

## Boundaries, and why they matter

- **Never use a password, `sshpass`, or `-o PasswordAuthentication=yes`.** A
  password passed on a command line ends up in the process list, shell history,
  and the agent's own transcript — it cannot be hidden. Key auth via the agent
  has no secret to leak. See `references/why-credential-free.md`.
- **Never put SSH passwords or keys in `.env`, code, or a committed file.**
  Plaintext on disk gets read, logged, and eventually committed; treat any such
  secret as already compromised.
- **Never type a raw IP/hostname/user.** Use the alias. Putting addresses in
  commands is what makes automated access look like network reconnaissance — and
  it was the trigger in the incident that motivated this skill.
- **Never disable host-key checking** (`StrictHostKeyChecking=no`). That silently
  accepts a changed key, which is the signature of a man-in-the-middle. The
  wrapper uses `accept-new`, which trusts first contact but refuses a *changed*
  key.
- **OT/ICS is special.** If the alias is a controller, PLC, historian, or sits on
  an OT/ICS subnet (e.g. Siemens S7/PLCSIM), default to read-only and require
  explicit, documented human authorization — ideally a change ticket — before any
  write, download, or setpoint change. Never do it autonomously. The reasoning,
  standards (NIST SP 800-82, IEC 62443, Purdue model), and an authorization
  checklist are in `references/ot-safety.md`.

## References

Read these when you need the detail; you don't need them for a normal run.

- `references/ssh-config-and-agent.md` — full `~/.ssh/config` directives, the
  ssh-agent workflow on Windows and Linux/macOS, host-key policy, the hardened
  ssh options the wrapper uses and why.
- `references/ot-safety.md` — gating access to OT/ICS and PLC systems: when to
  refuse, what authorization to require, and the relevant standards.
- `references/why-credential-free.md` — the threat model and the incident pattern
  this skill is designed to prevent.
