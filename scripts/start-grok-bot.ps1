# Restarts Grok Bot with the Chrome DevTools port enabled on 127.0.0.1 so grokctl can drive it.
# Usage: powershell -ExecutionPolicy Bypass -File scripts\start-grok-bot.ps1 [-Port 9333]
param([int]$Port = 9333)

$exe = Join-Path $env:LOCALAPPDATA 'Programs\Grok Bot\Grok Bot.exe'
if (-not (Test-Path $exe)) { Write-Error "Grok Bot not found at $exe"; exit 1 }

# Grok Bot is single-instance: it must be fully closed or the flag is ignored.
$procs = Get-Process 'Grok Bot' -ErrorAction SilentlyContinue
if ($procs) {
  Write-Host 'Closing Grok Bot...'
  $procs | ForEach-Object { $_.CloseMainWindow() | Out-Null }
  Start-Sleep -Seconds 4
  Get-Process 'Grok Bot' -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Seconds 2
}

Start-Process -FilePath $exe -ArgumentList "--remote-debugging-port=$Port", '--remote-debugging-address=127.0.0.1'

for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
    Write-Host "Grok Bot is up with DevTools on 127.0.0.1:$Port"
    exit 0
  }
}
Write-Error "Grok Bot started but port $Port is not listening."
exit 1
