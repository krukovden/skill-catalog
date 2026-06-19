# Gating access to OT / ICS / PLC systems

Operational-technology (OT) networks — PLCs, RTUs, historians, SCADA, things like
Siemens S7 / PLCSIM — are not normal servers. A wrong command can stop a process,
damage equipment, or trip safety systems, and these networks are watched closely.
Automated SSH from an AI tool into an OT subnet is, by default, treated as a
security incident. So the rule is conservative.

## When to stop and ask

Treat the target as OT/sensitive and apply the gate below if any of these are true:

- the alias name or the user's description mentions a PLC, controller, RTU, HMI,
  SCADA, historian, PLCSIM, S7, Modbus, Profinet, or a "lab"/"plant"/"OT" host;
- the user pastes an address in a known OT range (e.g. a segregated `192.168.x`
  industrial subnet) — note you should be using the *alias*, but if a raw address
  appears, that is itself a red flag;
- you are unsure whether the host is IT or OT.

## The gate

1. **Read-only by default.** Querying status, reading tags, tailing logs, listing
   files is usually fine. Anything that *changes* the controller — logic download,
   firmware upload, setpoint/tag write, start/stop, config change — is **not**
   something to do autonomously.

2. **A write requires explicit, documented human authorization.** Before any
   change, get from the user, in this turn:
   - confirmation they are authorized to change *this* host, and
   - a business justification, and
   - ideally a change ticket / reference.
   If you cannot get all three, do the read-only part and clearly say you are
   stopping short of the change and why.

3. **Never widen access on your own.** Do not add aliases to the allowlist, edit
   `~/.ssh/config`, disable host-key checking, or reach for a password to "make it
   work". Adding a host is a deliberate human act (run `setup-host`).

4. **Prefer the engineered path.** OT access should go through a hardened jump
   host / industrial DMZ, not straight from a workstation. If the only way you can
   reach the host is direct from the workstation, say so — that itself may be the
   thing to fix.

## Why this is the standard, not paranoia

These map to recognized OT-security guidance, which you can cite if the user asks:

- **NIST SP 800-82 Rev. 3** — Guide to Operational Technology Security.
- **IEC 62443** — zones & conduits with assigned security levels; least privilege
  and segmentation between IT and OT.
- **Purdue model** — controllers sit at Level 1; IT↔OT traffic should traverse a
  Level 3.5 industrial DMZ, never connect directly.
- **CISA ICS guidance** — centralize remote access behind hardened, monitored jump
  hosts with MFA and short-lived credentials; do not terminate remote sessions
  directly inside OT zones.

## If you receive (or caused) a security alert

This skill exists because automated `claude.exe` → PowerShell → SSH into an OT
subnet with stored credentials generated exactly such an alert. If the user is
responding to one: help them answer honestly (what ran, why, under whose
authorization), switch all future access to the alias + agent model in this skill,
and remove any stored SSH password from `.env`/scripts. Do not help disguise or
minimize past activity.
