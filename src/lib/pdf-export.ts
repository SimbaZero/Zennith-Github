import { jsPDF } from "jspdf";
import type { PatientRecord } from "@/lib/clinic-data";

const MARGIN = 56;
const PAGE_WIDTH = 595.28; // A4, points
const PAGE_HEIGHT = 841.89;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

function drawHeader(doc: jsPDF, y: number): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(20, 20, 40);
  doc.text("Zennith Health Services", MARGIN, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text("HILLBROW COMMUNITY HEALTH CENTRE", MARGIN, y + 12);

  const rightX = PAGE_WIDTH - MARGIN;
  doc.text("CONFIDENTIAL · MEDICAL RECORD", rightX, y, { align: "right" });
  doc.text(`Generated ${new Date().toLocaleString("en-ZA")}`, rightX, y + 12, {
    align: "right",
  });

  doc.setDrawColor(20, 20, 40);
  doc.setLineWidth(1.2);
  doc.line(MARGIN, y + 20, rightX, y + 20);

  return y + 40;
}

function drawSectionTitle(doc: jsPDF, title: string, y: number): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(20, 20, 40);
  doc.text(title.toUpperCase(), MARGIN, y);
  doc.setDrawColor(210, 210, 210);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, y + 4, PAGE_WIDTH - MARGIN, y + 4);
  return y + 20;
}

function drawRow(
  doc: jsPDF,
  label: string,
  value: string,
  x: number,
  y: number,
  colWidth: number,
): void {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(130, 130, 130);
  doc.text(label.toUpperCase(), x, y);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(20, 20, 20);
  doc.text(String(value ?? "—"), x, y + 12, { maxWidth: colWidth });
}

/** Generates and triggers a download of a real, selectable-text PDF for
 *  this patient's record — mirrors the on-screen layout in PatientRecordView. */
export function generatePatientRecordPdf(record: PatientRecord): void {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  let y = MARGIN;
  y = drawHeader(doc, y);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(20, 20, 20);
  doc.text(record.name, MARGIN, y);
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text(`Patient ID: ${record.patientId}`, MARGIN, y);
  y += 24;

  const colWidth = (CONTENT_WIDTH - 24) / 2;
  const col2X = MARGIN + colWidth + 24;

  y = drawSectionTitle(doc, "Personal Information", y);
  const personalRows: [string, string][] = [
    ["Full Name", record.name],
    ["Patient ID", record.patientId],
    ["ID Number", record.idNumber],
    ["Cell Phone", record.cell],
    ["Email", record.email],
    ["Address", record.address],
    ["Emergency Contact", record.emergencyContactName],
    ["Emergency Phone", record.emergencyContactNo],
  ];
  personalRows.forEach(([label, value], i) => {
    const x = i % 2 === 0 ? MARGIN : col2X;
    drawRow(doc, label, value, x, y + Math.floor(i / 2) * 28, colWidth);
  });
  y += Math.ceil(personalRows.length / 2) * 28 + 12;

  y = drawSectionTitle(doc, "Medical History", y);
  const medicalRows: [string, string][] = [
    ["Primary Condition", record.condition],
    ["Blood Type", record.bloodType],
    ["Allergies", record.allergies],
    ["Prescription", record.prescription],
    ["Dosage", record.dosage],
    ["Blood Pressure", record.bp],
    ["Glucose", record.glucose],
    ["CD4 Count", record.cd4],
    ["Viral Load", record.viralLoad],
    ["Insurance", record.insurance],
    ["Last Visit", record.lastVisit],
    ["Next Appointment", record.nextAppointment],
  ];
  medicalRows.forEach(([label, value], i) => {
    const x = i % 2 === 0 ? MARGIN : col2X;
    drawRow(doc, label, value, x, y + Math.floor(i / 2) * 28, colWidth);
  });
  y += Math.ceil(medicalRows.length / 2) * 28 + 12;

  if (y > PAGE_HEIGHT - 150) {
    doc.addPage();
    y = MARGIN;
  }

  y = drawSectionTitle(doc, "Clinical Notes", y);
  if (record.history.length === 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(130, 130, 130);
    doc.text("No clinical notes on file.", MARGIN, y);
  } else {
    doc.setFontSize(9);
    doc.setTextColor(20, 20, 20);
    for (const h of record.history) {
      const lines = doc.splitTextToSize(
        h.description,
        CONTENT_WIDTH,
      ) as string[];
      if (y + lines.length * 12 > PAGE_HEIGHT - MARGIN) {
        doc.addPage();
        y = MARGIN;
      }
      doc.setFont("helvetica", "normal");
      doc.text(lines, MARGIN, y);
      y += lines.length * 12 + 8;
    }
  }

  doc.save(`${record.patientId}-medical-record.pdf`);
}
