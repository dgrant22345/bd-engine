$path = '.\app\styles.css'
$content = Get-Content $path -Raw
# Tone down solid white backgrounds and borders to be translucent for dark mode glassmorphism
$content = $content -replace 'rgba\(255,\s*255,\s*255,\s*0\.[789]\d*\)', 'rgba(255, 255, 255, 0.05)'
$content = $content -replace 'rgba\(255,\s*255,\s*255,\s*1\)', 'rgba(255, 255, 255, 0.1)'
$content = $content -replace 'rgba\(247,\s*249,\s*252,\s*0\.\d*\)', 'rgba(255, 255, 255, 0.03)'
Set-Content -Path $path -Value $content -NoNewline
