import { crc32 } from 'node:zlib';

export interface MockFile {
  contentType: string;
  filename: string;
  body: Buffer;
}

const PDF_TYPE = 'application/pdf';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function buildPdf(): Buffer {
  const stream = 'BT /F1 18 Tf 72 720 Td (Collection Copilot - report di esempio (mock)) Tj ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** Zip "stored" (senza compressione) con data fissa, quindi byte-identico a ogni esecuzione. */
function zip(entries: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name);
    const data = Buffer.from(text);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x21, 12); // data DOS 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, data);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x21, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

function buildXlsx(): Buffer {
  const xml = '<?xml version="1.0" encoding="UTF-8"?>';
  const rels = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const pkg = 'http://schemas.openxmlformats.org/package/2006/relationships';
  return zip({
    '[Content_Types].xml': `${xml}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    '_rels/.rels': `${xml}<Relationships xmlns="${pkg}"><Relationship Id="rId1" Type="${rels}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `${xml}<workbook xmlns="${main}" xmlns:r="${rels}"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `${xml}<Relationships xmlns="${pkg}"><Relationship Id="rId1" Type="${rels}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': `${xml}<worksheet xmlns="${main}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Collector</t></is></c><c r="B1" t="inlineStr"><is><t>Indice</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>FIDES</t></is></c><c r="B2"><v>1.18</v></c></row></sheetData></worksheet>`,
  });
}

/** File di esempio noti (id come nei blocchi file degli scenari). */
export function mockFiles(): Map<string, MockFile> {
  return new Map<string, MockFile>([
    ['f-20261013-001', { contentType: PDF_TYPE, filename: 'report-performance-2026-10-13.pdf', body: buildPdf() }],
    ['f-20261013-002', { contentType: XLSX_TYPE, filename: 'report-performance-2026-10-13.xlsx', body: buildXlsx() }],
  ]);
}
