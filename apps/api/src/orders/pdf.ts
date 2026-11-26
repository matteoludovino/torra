/**
 * A one-page PDF of plain text (Helvetica, A4), written by hand: enough for the store's downloads, with no
 * dependency. Text is encoded as WinAnsi, which covers Portuguese.
 */
export interface PdfLine {
  text: string;
  size?: number;
  bold?: boolean;
  /** Space before the line, in points. */
  gap?: number;
}

const WIDTH = 595;
const HEIGHT = 842;
const MARGIN = 56;

export function simplePdf(lines: PdfLine[]): Buffer {
  const content: string[] = ["BT"];
  let y = HEIGHT - MARGIN;
  for (const line of lines) {
    const size = line.size ?? 11;
    // A rough wrap: Helvetica's average glyph is about half its size wide.
    const perLine = Math.floor((WIDTH - 2 * MARGIN) / (size * 0.5));
    y -= line.gap ?? 0;
    for (const part of wrap(line.text, perLine)) {
      y -= size * 1.4;
      if (y < MARGIN) break;
      content.push(
        `/${line.bold ? "F2" : "F1"} ${size} Tf 1 0 0 1 ${MARGIN} ${y.toFixed(1)} Tm (${escape(part)}) Tj`,
      );
    }
  }
  content.push("ET");
  const stream = Buffer.from(content.join("\n"), "latin1");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${WIDTH} ${HEIGHT}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  ];
  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  const offsets: number[] = [];
  let length = chunks[0]!.length;
  const push = (chunk: Buffer) => {
    chunks.push(chunk);
    length += chunk.length;
  };
  objects.forEach((body, i) => {
    offsets.push(length);
    push(Buffer.from(`${i + 1} 0 obj\n${body}\nendobj\n`, "latin1"));
  });
  offsets.push(length);
  push(Buffer.from(`6 0 obj\n<< /Length ${stream.length} >>\nstream\n`, "latin1"));
  push(stream);
  push(Buffer.from("\nendstream\nendobj\n", "latin1"));
  const xref = length;
  const entries = offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  push(
    Buffer.from(
      `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n${entries}trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
      "latin1",
    ),
  );
  return Buffer.concat(chunks);
}

function wrap(text: string, perLine: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (current && current.length + 1 + word.length > perLine) {
      lines.push(current);
      current = word;
    } else current = current ? `${current} ${word}` : word;
  }
  return current ? [...lines, current] : [""];
}

/** WinAnsi differs from Latin-1 in 0x80–0x9F, where typography lives. */
const WIN_ANSI: Record<string, string> = {
  "—": "\x97",
  "–": "\x96",
  "“": "\x93",
  "”": "\x94",
  "‘": "\x91",
  "’": "\x92",
  "…": "\x85",
  "•": "\x95",
};

function escape(text: string): string {
  return [...text]
    .map((char) => WIN_ANSI[char] ?? (char.charCodeAt(0) <= 0xff ? char : "?"))
    .join("")
    .replace(/[\\()]/g, (char) => `\\${char}`);
}
