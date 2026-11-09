$ErrorActionPreference = 'Stop'
$reportDir = $PSScriptRoot
$reportPath = (Get-ChildItem -LiteralPath $reportDir -Filter '*.docx' | Select-Object -First 1).FullName
$pdfPath = Join-Path (Join-Path $reportDir 'render') 'report.pdf'
New-Item -ItemType Directory -Path (Join-Path $reportDir 'render') -Force | Out-Null
$word = $null
$document = $null
try {
    $word = New-Object -ComObject Word.Application
    Write-Output 'Word instance created'
    $word.Visible = $false
    $word.DisplayAlerts = 0
    Write-Output 'Opening report'
    $document = $word.Documents.Open($reportPath, $false, $true)
    Write-Output 'Report opened'
    $document.Repaginate()
    Write-Output 'Repaginated'
    Write-Output 'Exporting PDF'
    $document.ExportAsFixedFormat($pdfPath, 17)
    Write-Output 'PDF exported'
    Write-Output $pdfPath
} finally {
    if ($null -ne $document) { $document.Close(0) }
    if ($null -ne $word) { $word.Quit() }
}
