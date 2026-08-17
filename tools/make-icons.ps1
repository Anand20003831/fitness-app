# Regenerates the PNGs in icons/. Run it only if you want to change the icon.
# The app itself has no build step; this is a one-off drawing tool, and its
# output is committed so nothing has to be built to serve the site.
#
#   powershell -ExecutionPolicy Bypass -File tools/make-icons.ps1

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Definition)
$outDir = Join-Path $root 'icons'
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

$bg   = [System.Drawing.ColorTranslator]::FromHtml('#0f1115')
$ink  = [System.Drawing.ColorTranslator]::FromHtml('#e8ecf1')

function New-RoundedPath {
  param([single]$X, [single]$Y, [single]$W, [single]$H, [single]$R)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $R * 2
  if ($d -gt [Math]::Min($W, $H)) { $d = [Math]::Min($W, $H) }
  $path.AddArc($X, $Y, $d, $d, 180, 90)
  $path.AddArc($X + $W - $d, $Y, $d, $d, 270, 90)
  $path.AddArc($X + $W - $d, $Y + $H - $d, $d, $d, 0, 90)
  $path.AddArc($X, $Y + $H - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

# A barbell: centre bar, a thick plate each side, a thinner collar outside it.
function Draw-Icon {
  param([int]$Size, [string]$Path, [double]$GlyphScale = 1.0, [bool]$FullBleed = $false)

  $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  $bgBrush = New-Object System.Drawing.SolidBrush($bg)
  if ($FullBleed) {
    $g.FillRectangle($bgBrush, 0, 0, $Size, $Size)
  } else {
    $square = New-RoundedPath 0 0 $Size $Size ($Size * 0.22)
    $g.FillPath($bgBrush, $square)
    $square.Dispose()
  }

  $inkBrush = New-Object System.Drawing.SolidBrush($ink)
  $s = [single]($Size * $GlyphScale)
  $ox = [single](($Size - $s) / 2)
  $oy = [single](($Size - $s) / 2)
  $mid = [single]($oy + $s / 2)

  $shapes = @(
    # bar
    @{ x = 0.255; y = 0.4625; w = 0.49;  h = 0.075; r = 0.037 },
    # inner plates
    @{ x = 0.245; y = 0.335;  w = 0.085; h = 0.330; r = 0.030 },
    @{ x = 0.670; y = 0.335;  w = 0.085; h = 0.330; r = 0.030 },
    # outer collars
    @{ x = 0.160; y = 0.395;  w = 0.060; h = 0.210; r = 0.024 },
    @{ x = 0.780; y = 0.395;  w = 0.060; h = 0.210; r = 0.024 }
  )

  # Not $path: this function has a [string]$Path parameter, and PowerShell keeps
  # the type constraint on the name, so assigning a GraphicsPath to it silently
  # turns the object into the string "System.Drawing.Drawing2D.GraphicsPath".
  foreach ($shape in $shapes) {
    $shapePath = New-RoundedPath ($ox + $s * $shape.x) ($oy + $s * $shape.y) `
                                 ($s * $shape.w) ($s * $shape.h) ($s * $shape.r)
    $g.FillPath($inkBrush, $shapePath)
    $shapePath.Dispose()
  }

  $g.Dispose()
  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  "{0}  {1}x{1}" -f (Split-Path -Leaf $Path), $Size
}

Draw-Icon -Size 192 -Path (Join-Path $outDir 'icon-192.png')
Draw-Icon -Size 512 -Path (Join-Path $outDir 'icon-512.png')
# Maskable icons get cropped to a circle by Android, so the glyph shrinks into
# the safe zone and the background runs to the edges.
Draw-Icon -Size 512 -Path (Join-Path $outDir 'icon-maskable-512.png') -GlyphScale 0.66 -FullBleed $true
Draw-Icon -Size 32  -Path (Join-Path $outDir 'favicon-32.png')
