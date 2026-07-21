# ops

Skills for operating machines and infrastructure — remote access, deployment, environments.

**Promoted**: skills here ship in `catalog.json` and the Claude plugin.

- **[safety-ssh](./safety-ssh/SKILL.md)** — Connect to remote servers over SSH without the assistant ever handling passwords, usernames, hostnames, or IPs. Everything goes through a named connection whose real details live in `~/.ssh/config` and whose key lives in `ssh-agent`.
