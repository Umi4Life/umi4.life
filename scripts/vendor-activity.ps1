# Fetch the latest vendored activity JSON from git-activity for local Hugo dev.
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Target = Join-Path $Root "static\data\activity.json"
$Url = "https://raw.githubusercontent.com/Umi4Life/git-activity/master/data/activity.json"

New-Item -ItemType Directory -Force -Path (Split-Path $Target) | Out-Null
Invoke-WebRequest -Uri $Url -OutFile $Target -UseBasicParsing
Write-Host "Vendored activity data to $Target"
