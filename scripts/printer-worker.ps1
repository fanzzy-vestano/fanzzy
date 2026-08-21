param([string]$PrinterName, [string]$QrPath)
$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class FanzzyPersistentRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO { public string pDocName = "Fanzzy Bill"; public string pOutputFile = null; public string pDataType = "RAW"; }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", CharSet = CharSet.Unicode, SetLastError = true)] public static extern int StartDocPrinter(IntPtr handle, int level, [In] DOCINFO info);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool WritePrinter(IntPtr handle, byte[] data, int count, out int written);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool ClosePrinter(IntPtr handle);
}
"@

Add-Type -AssemblyName System.Drawing

function Convert-ImageToRaster([string]$ImagePath, [int]$TargetWidth) {
  if (-not $ImagePath -or -not (Test-Path -LiteralPath $ImagePath)) { return [byte[]]@() }
  $source = [System.Drawing.Bitmap]::FromFile($ImagePath)
  try {
    $minX = $source.Width; $minY = $source.Height; $maxX = -1; $maxY = -1
    for ($y = 0; $y -lt $source.Height; $y++) {
      for ($x = 0; $x -lt $source.Width; $x++) {
        $pixel = $source.GetPixel($x, $y)
        if ($pixel.A -gt 20 -and ($pixel.R -lt 245 -or $pixel.G -lt 245 -or $pixel.B -lt 245)) {
          if ($x -lt $minX) { $minX = $x }; if ($y -lt $minY) { $minY = $y }; if ($x -gt $maxX) { $maxX = $x }; if ($y -gt $maxY) { $maxY = $y }
        }
      }
    }
    if ($maxX -lt $minX -or $maxY -lt $minY) { return [byte[]]@() }
    $cropWidth = $maxX - $minX + 1; $cropHeight = $maxY - $minY + 1
    # The supplied QR is a 33-module square. Five printer dots per module
    # keeps each block square while retaining the existing 208-dot image area.
    $targetHeight = $TargetWidth
    $canvasWidth = 208
    $canvasHeight = 208
    $left = [int][Math]::Floor(($canvasWidth - $TargetWidth) / 2)
    $top = [int][Math]::Floor(($canvasHeight - $targetHeight) / 2)
    $target = [System.Drawing.Bitmap]::new($canvasWidth, $canvasHeight, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($target)
      try {
        $graphics.Clear([System.Drawing.Color]::White)
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
        $graphics.DrawImage($source, [System.Drawing.Rectangle]::new($left, $top, $TargetWidth, $targetHeight), $minX, $minY, $cropWidth, $cropHeight, [System.Drawing.GraphicsUnit]::Pixel)
      } finally { $graphics.Dispose() }
      $bytesPerRow = [int][Math]::Ceiling($canvasWidth / 8.0)
      $raster = New-Object byte[] ($bytesPerRow * $canvasHeight)
      for ($y = 0; $y -lt $canvasHeight; $y++) {
        for ($x = 0; $x -lt $canvasWidth; $x++) {
          $pixel = $target.GetPixel($x, $y); $gray = (0.299 * $pixel.R) + (0.587 * $pixel.G) + (0.114 * $pixel.B)
          if ($gray -lt 128) { $index = ($y * $bytesPerRow) + [int]($x / 8); $raster[$index] = [byte]($raster[$index] -bor (1 -shl (7 - ($x % 8)))) }
        }
      }
      $header = [byte[]](0x1D, 0x76, 0x30, 0x00, [byte]($bytesPerRow -band 0xFF), [byte](($bytesPerRow -shr 8) -band 0xFF), [byte]($canvasHeight -band 0xFF), [byte](($canvasHeight -shr 8) -band 0xFF))
      $prefix = [byte[]](0x1B, 0x61, 0x01); $suffix = [byte[]](0x1B, 0x61, 0x00, 0x0A, 0x0A)
      $image = New-Object byte[] ($prefix.Length + $header.Length + $raster.Length + $suffix.Length)
      [Array]::Copy($prefix, 0, $image, 0, $prefix.Length); [Array]::Copy($header, 0, $image, $prefix.Length, $header.Length); [Array]::Copy($raster, 0, $image, $prefix.Length + $header.Length, $raster.Length); [Array]::Copy($suffix, 0, $image, $prefix.Length + $header.Length + $raster.Length, $suffix.Length)
      return $image
    } finally { $target.Dispose() }
  } finally { $source.Dispose() }
}

function Replace-Bytes([byte[]]$Source, [byte[]]$Marker, [byte[]]$Replacement) {
  $result = New-Object System.Collections.Generic.List[byte]
  for ($i = 0; $i -lt $Source.Length;) {
    $matches = $i + $Marker.Length -le $Source.Length
    if ($matches) { for ($j = 0; $j -lt $Marker.Length; $j++) { if ($Source[$i + $j] -ne $Marker[$j]) { $matches = $false; break } } }
    if ($matches) { $result.AddRange($Replacement); $i += $Marker.Length } else { $result.Add($Source[$i]); $i++ }
  }
  return [byte[]]$result.ToArray()
}

$qrRaster = Convert-ImageToRaster $QrPath 165
$qrMarker = [System.Text.Encoding]::UTF8.GetBytes('<<FANZZY_QR>>')

function Send-RawPayload([byte[]]$Payload) {
  $handle = [IntPtr]::Zero
  if (-not [FanzzyPersistentRawPrinter]::OpenPrinter($PrinterName, [ref]$handle, [IntPtr]::Zero)) { throw "Could not open printer: $PrinterName" }
  try {
    $doc = New-Object FanzzyPersistentRawPrinter+DOCINFO
    if ([FanzzyPersistentRawPrinter]::StartDocPrinter($handle, 1, $doc) -eq 0) { throw "Could not start printer job" }
    try {
      if (-not [FanzzyPersistentRawPrinter]::StartPagePrinter($handle)) { throw "Could not start printer page" }
      try {
        $printPayload = Replace-Bytes $Payload $qrMarker $qrRaster
        $written = 0
        if (-not [FanzzyPersistentRawPrinter]::WritePrinter($handle, $printPayload, $printPayload.Length, [ref]$written) -or $written -ne $printPayload.Length) { throw "Could not send the bill to the printer" }
      } finally { [FanzzyPersistentRawPrinter]::EndPagePrinter($handle) | Out-Null }
    } finally { [FanzzyPersistentRawPrinter]::EndDocPrinter($handle) | Out-Null }
  } finally { [FanzzyPersistentRawPrinter]::ClosePrinter($handle) | Out-Null }
}

[Console]::Out.WriteLine("READY")
[Console]::Out.Flush()
while (($line = [Console]::ReadLine()) -ne $null) {
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  try {
    Send-RawPayload ([Convert]::FromBase64String($line))
    [Console]::Out.WriteLine("OK")
  } catch {
    [Console]::Out.WriteLine(("ERR:" + $_.Exception.Message).Replace("`r", " ").Replace("`n", " "))
  }
  [Console]::Out.Flush()
}
