import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import Papa from 'papaparse';

/**
 * §15 — shared with SequenceImportsService's own private parseFile in
 * spirit (same exact rules: first worksheet only, header row 1, blank rows
 * excluded), kept as a separate copy here rather than refactoring that
 * already-validated legacy service to depend on it.
 */
export async function parseTabularFile(file: {
  buffer: Buffer;
  originalName: string;
}): Promise<{ rows: Record<string, string>[]; headers: string[] }> {
  const lowerName = file.originalName.toLowerCase();

  if (lowerName.endsWith('.xlsx')) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer as unknown as ExcelJS.Buffer);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new BadRequestException('El archivo .xlsx no contiene ninguna hoja.');
    }

    const headers: string[] = [];
    worksheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
      headers[colNumber - 1] = String(cell.text ?? '').trim();
    });

    const rows: Record<string, string>[] = [];
    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const record: Record<string, string> = {};
      let hasValue = false;
      headers.forEach((header, index) => {
        if (!header) return;
        const value = String(row.getCell(index + 1).text ?? '').trim();
        record[header] = value;
        if (value) hasValue = true;
      });
      if (hasValue) rows.push(record);
    }
    return { rows, headers };
  }

  if (lowerName.endsWith('.csv')) {
    const parsed = Papa.parse<Record<string, string>>(file.buffer.toString('utf-8'), {
      header: true,
      skipEmptyLines: true,
    });
    return { rows: parsed.data, headers: parsed.meta.fields ?? [] };
  }

  throw new BadRequestException('Formato de archivo no soportado — solo se permiten .xlsx o .csv.');
}
