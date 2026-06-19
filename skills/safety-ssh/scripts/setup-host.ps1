<#
.SYNOPSIS
  setup-host — one-time, HUMAN-run setup for credential-free SSH to one host (Windows).
.DESCRIPTION
  A human runs this, not the AI agent: it involves the key passphrase and the real
  address of the host, which must never pass through the agent. It enables the
  ssh-agent service, generates an ed25519 key WITH a passphrase, loads it, writes a
  `Host <alias>` block to ~/.ssh/config, adds the alias to the allowlist, and prints
  the public key to install on the host.
.EXAMPLE
  .\setup-host.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$sshDir    = Join-Path $env:USERPROFILE '.ssh'
$config    = Join-Path $sshDir 'config'
$allowlist = if ($env:SAFE_SSH_ALLOWLIST) { $env:SAFE_SSH_ALLOWLIST } else { Join-Path $sshDir 'claude-allowed-hosts' }

New-Item -ItemType Directory -Force -Path $sshDir | Out-Null

$alias = (Read-Host 'Alias to use (what you and the agent will type, e.g. plcsim-lab)').Trim()
if (-not $alias) { throw 'alias is required' }
if ($alias -match '^[-/]' -or $alias -match '[\s\\/]') { throw 'alias must be a bare token (no spaces, slashes, leading -)' }

$hostname = (Read-Host 'Real hostname or IP (stays in ~/.ssh/config, never shown to the agent)').Trim()
if (-not $hostname) { throw 'hostname is required' }

$userOnHost = (Read-Host 'Login user on the host').Trim()
if (-not $userOnHost) { throw 'user is required' }

$port = (Read-Host 'SSH port [22]').Trim()
if (-not $port) { $port = '22' }

# Ensure the ssh-agent service is running and set to start automatically.
$svc = Get-Service ssh-agent -ErrorAction SilentlyContinue
if (-not $svc) { throw 'OpenSSH client (ssh-agent service) not found. Install the Windows OpenSSH Client feature first.' }
if ($svc.StartType -ne 'Automatic') { Set-Service ssh-agent -StartupType Automatic }
if ($svc.Status -ne 'Running') { Start-Service ssh-agent }

$keyfile = Join-Path $sshDir ("id_ed25519_{0}" -f $alias)
if (Test-Path -LiteralPath $keyfile) {
  Write-Host "Key $keyfile already exists - reusing it."
} else {
  Write-Host 'Generating an ed25519 key WITH a passphrase. Choose a strong passphrase when prompted.'
  & ssh-keygen -t ed25519 -f $keyfile -C ("claude-agent-{0}" -f $alias)
}

& ssh-add $keyfile

# Append a Host block if not already present.
if (-not (Test-Path -LiteralPath $config)) { New-Item -ItemType File -Force -Path $config | Out-Null }
$configText = Get-Content -LiteralPath $config -Raw -ErrorAction SilentlyContinue
if ($configText -and ($configText -match "(?im)^\s*Host\s+$([regex]::Escape($alias))(\s|$)")) {
  Write-Host "A Host block for '$alias' already exists in $config - leaving it unchanged."
} else {
  $block = @"

Host $alias
    HostName $hostname
    User $userOnHost
    Port $port
    IdentityFile $keyfile
    IdentitiesOnly yes
    AddKeysToAgent yes
    ForwardAgent no
    StrictHostKeyChecking accept-new
"@
  Add-Content -LiteralPath $config -Value $block
  Write-Host "Added Host block for '$alias' to $config"
}

# Add to the allowlist (the deliberate act of authorization).
if (-not (Test-Path -LiteralPath $allowlist)) { New-Item -ItemType File -Force -Path $allowlist | Out-Null }
$approved = Get-Content -LiteralPath $allowlist | ForEach-Object { $_.Trim() }
if ($approved -contains $alias) {
  Write-Host "'$alias' is already in the allowlist."
} else {
  Add-Content -LiteralPath $allowlist -Value $alias
  Write-Host "Authorized '$alias' in $allowlist"
}

Write-Host ''
Write-Host "Install this PUBLIC key on the host (append to ~/.ssh/authorized_keys for $userOnHost):"
Write-Host '----------------------------------------------------------------------'
Get-Content -LiteralPath ("$keyfile.pub")
Write-Host '----------------------------------------------------------------------'
Write-Host ''
Write-Host "Then verify with:  .\check-setup.ps1 $alias"
