"use client";

// Print / download controls for the invoice page. "Download PDF" opens the
// browser print dialog → the admin picks "Save as PDF". Hidden when printing.
// Also sets document.title so the Save-as-PDF filename is the invoice no. +
// client name (browsers derive the default filename from the page title).
import { useEffect } from "react";
import { Printer, ArrowLeft } from "lucide-react";

export default function PrintControls({ docTitle }: { docTitle?: string }) {
  useEffect(() => {
    if (docTitle) document.title = docTitle;
  }, [docTitle]);

  return (
    <div className="no-print" style={{ display: "flex", gap: 10, justifyContent: "center", margin: "22px 0 8px" }}>
      <button
        onClick={() => window.print()}
        style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          background: "#f5b100", color: "#1a1a1a", fontWeight: 800,
          border: "none", borderRadius: 10, padding: "10px 18px", cursor: "pointer", fontSize: 14,
        }}
      >
        <Printer size={16} /> Muat turun PDF
      </button>
      <button
        onClick={() => window.history.length > 1 ? window.history.back() : window.close()}
        style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          background: "#fff", color: "#374151", fontWeight: 700,
          border: "1px solid #d1d5db", borderRadius: 10, padding: "10px 18px", cursor: "pointer", fontSize: 14,
        }}
      >
        <ArrowLeft size={16} /> Kembali
      </button>
    </div>
  );
}
