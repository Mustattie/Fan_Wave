# Regenerate the Expo Go QR image in this folder.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\qa\generate-expo-qr.ps1
#   powershell -ExecutionPolicy Bypass -File .\qa\generate-expo-qr.ps1 -Port 8081 -Out .\qa\v9.1-uat-expo-go.png
#
# Auto-detects your live Wi-Fi IPv4 and encodes exp://<ip>:<port> into a
# 512x512 PNG. Requires: python + `qrcode[pil]` (installed if missing).

param(
  [int]$Port = 8082,
  [string]$Out = "$PSScriptRoot\v9.1-uat-expo-go.png"
)

$wifi = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike '169.*' -and $_.IPAddress -ne '127.0.0.1' -and $_.InterfaceAlias -like '*Wi-Fi*' } |
  Select-Object -First 1

if (-not $wifi) {
  Write-Error "No Wi-Fi IPv4 found. Are you connected to a network? Fall back to tunnel mode: npx expo start --go --tunnel"
  exit 1
}

$ip = $wifi.IPAddress
$url = "exp://${ip}:${Port}"
Write-Host "Encoding $url  ->  $Out"

python -c @"
import qrcode, sys
url = sys.argv[1]
out = sys.argv[2]
img = qrcode.make(url, box_size=12, border=4)
img = img.resize((512, 512))
img.save(out)
print('wrote', out)
"@ $url $Out

if ($LASTEXITCODE -ne 0) {
  Write-Host "python/qrcode missing. Installing..."
  python -m pip install --quiet "qrcode[pil]"
  python -c @"
import qrcode, sys
url = sys.argv[1]
out = sys.argv[2]
img = qrcode.make(url, box_size=12, border=4)
img = img.resize((512, 512))
img.save(out)
print('wrote', out)
"@ $url $Out
}
