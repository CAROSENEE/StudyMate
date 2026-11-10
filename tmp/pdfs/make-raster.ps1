$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$root=(Resolve-Path '.').Path
$pngs=Get-ChildItem (Join-Path $root 'tmp\pdfs') -Filter 'verify-*.png' | Sort-Object Name
if($pngs.Count -ne 6){throw "Expected 6 pages, found $($pngs.Count)"}
$ascii=[System.Text.Encoding]::ASCII
$objs=[System.Collections.Generic.List[byte[]]]::new()
$objs.Add($ascii.GetBytes('<< /Type /Catalog /Pages 2 0 R >>'))
$kids=(0..5|%{"$(3+3*$_) 0 R"}) -join ' '
$objs.Add($ascii.GetBytes("<< /Type /Pages /Kids [$kids] /Count 6 >>"))
foreach($png in $pngs){
  $bm=[System.Drawing.Bitmap]::new($png.FullName); $w=$bm.Width; $h=$bm.Height
  $mem=[System.IO.MemoryStream]::new(); $bm.Save($mem,[System.Drawing.Imaging.ImageFormat]::Jpeg); $jpg=$mem.ToArray(); $mem.Dispose(); $bm.Dispose()
  $pageObjectId=3+($objs.Count-2); $iid=$pageObjectId+1; $cid=$pageObjectId+2
  $objs.Add($ascii.GetBytes("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 $iid 0 R >> >> /Contents $cid 0 R >>"))
  $ih=$ascii.GetBytes("<< /Type /XObject /Subtype /Image /Width $w /Height $h /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length $($jpg.Length) >>`nstream`n")
  $ib=[byte[]]::new($ih.Length+$jpg.Length+11); [Array]::Copy($ih,0,$ib,0,$ih.Length); [Array]::Copy($jpg,0,$ib,$ih.Length,$jpg.Length); [Array]::Copy($ascii.GetBytes("`nendstream"),0,$ib,$ih.Length+$jpg.Length,10); $objs.Add($ib)
  $cb=$ascii.GetBytes('q 595 0 0 842 0 0 cm /Im0 Do Q'); $ch=$ascii.GetBytes("<< /Length $($cb.Length) >>`nstream`n")
  $co=[byte[]]::new($ch.Length+$cb.Length+10); [Array]::Copy($ch,0,$co,0,$ch.Length); [Array]::Copy($cb,0,$co,$ch.Length,$cb.Length); [Array]::Copy($ascii.GetBytes("`nendstream"),0,$co,$ch.Length+$cb.Length,10); $objs.Add($co)
}
$ms=[System.IO.MemoryStream]::new(); $bw=[System.IO.BinaryWriter]::new($ms)
$bw.Write($ascii.GetBytes("%PDF-1.4`n%StudyMate proposal`n")); $offsets=[System.Collections.Generic.List[long]]::new(); $offsets.Add(0)
for($i=0;$i -lt $objs.Count;$i++){ $offsets.Add($ms.Position); $bw.Write($ascii.GetBytes("$($i+1) 0 obj`n")); $bw.Write($objs[$i]); $bw.Write($ascii.GetBytes("`nendobj`n")) }
$xref=$ms.Position; $bw.Write($ascii.GetBytes("xref`n0 $($objs.Count+1)`n0000000000 65535 f `n")); for($i=1;$i -lt $offsets.Count;$i++){$bw.Write($ascii.GetBytes(('{0:D10} 00000 n ' -f $offsets[$i])+"`n"))}; $bw.Write($ascii.GetBytes("trailer`n<< /Size $($objs.Count+1) /Root 1 0 R >>`nstartxref`n$xref`n%%EOF`n")); $bw.Flush()
$out=Join-Path $root 'output\pdf\Smart_StudyMate_Project_Proposal_BN.pdf'; [System.IO.File]::WriteAllBytes($out,$ms.ToArray()); $bw.Dispose(); $ms.Dispose(); Get-Item $out | Select-Object FullName,Length

