from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle


OUTPUT = "Rafam_General_Trading_Proforma.pdf"
TEAL = colors.HexColor("#0D5C63")
INK = colors.HexColor("#1F2933")
MIST = colors.HexColor("#EDF5F5")


def money(amount):
    return f"{amount:,.2f} ETB"


styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name="DocTitle", parent=styles["Title"], fontName="Helvetica-Bold",
    fontSize=24, leading=28, textColor=TEAL, spaceAfter=4,
))
styles.add(ParagraphStyle(
    name="Subtle", parent=styles["Normal"], fontName="Helvetica", fontSize=9,
    leading=13, textColor=colors.HexColor("#52616B"),
))
styles.add(ParagraphStyle(
    name="Section", parent=styles["Heading2"], fontName="Helvetica-Bold",
    fontSize=12, leading=16, textColor=TEAL, spaceBefore=14, spaceAfter=6,
))
styles.add(ParagraphStyle(
    name="Body", parent=styles["Normal"], fontName="Helvetica", fontSize=9.5,
    leading=14, textColor=INK,
))
styles.add(ParagraphStyle(
    name="Right", parent=styles["Body"], alignment=TA_RIGHT,
))


doc = SimpleDocTemplate(
    OUTPUT, pagesize=A4, rightMargin=18*mm, leftMargin=18*mm,
    topMargin=16*mm, bottomMargin=16*mm,
)
story = []

story.append(Paragraph("PROFORMA INVOICE", styles["DocTitle"]))
story.append(Paragraph("Website, Branding & Stock Management ERP System", styles["Subtle"]))
story.append(Spacer(1, 9*mm))

meta = Table([
    [Paragraph("<b>Prepared for</b><br/>Rafam General Trading", styles["Body"]),
     Paragraph("<b>Currency</b><br/>Ethiopian Birr (ETB)", styles["Body"]),
     Paragraph("<b>Quotation validity</b><br/>15 days", styles["Body"])],
    [Paragraph("<b>Prepared by</b><br/>iConnect", styles["Body"]),
     Paragraph("<b>VAT</b><br/>15%", styles["Body"]),
     Paragraph("<b>Estimated delivery</b><br/>30–45 working days", styles["Body"])],
], colWidths=[58*mm, 50*mm, 48*mm])
meta.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), MIST),
    ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#BED8DA")),
    ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#BED8DA")),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 7),
    ("RIGHTPADDING", (0, 0), (-1, -1), 7),
    ("TOPPADDING", (0, 0), (-1, -1), 7),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
]))
story.append(meta)
story.append(Paragraph("Scope of Work & Pricing", styles["Section"]))

rows = [
    ["No.", "Service", "What is Included", "Amount"],
    ["1", "Branding & Visual Identity", "Logo design, color palette, typography, business-card design, letterhead, social-media profile assets, and brand guidelines.", money(65000)],
    ["2", "Company Website", "Responsive website; Home, About, Services/Products and Contact pages; contact form, Google Maps, basic SEO, domain/hosting setup, and administrator training.", money(80000)],
    ["3", "Stock Management ERP System", "Product and supplier records, stock-in/stock-out, low-stock alerts, sales and inventory reports, user accounts, dashboard, data backup, and staff training.", money(200000)],
]
table_rows = []
for r, row in enumerate(rows):
    table_rows.append([
        Paragraph(str(cell), styles["Body"] if r else ParagraphStyle("Header", parent=styles["Body"], textColor=colors.white, fontName="Helvetica-Bold", leading=12))
        for cell in row
    ])

pricing = Table(table_rows, colWidths=[10*mm, 38*mm, 79*mm, 29*mm], repeatRows=1)
pricing.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), TEAL),
    ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#C9D4D6")),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 5),
    ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ("TOPPADDING", (0, 0), (-1, -1), 6),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ("BACKGROUND", (0, 1), (-1, -1), colors.white),
    ("BACKGROUND", (0, 2), (-1, 2), colors.HexColor("#F7FAFA")),
    ("ALIGN", (0, 0), (0, -1), "CENTER"),
    ("ALIGN", (-1, 0), (-1, -1), "RIGHT"),
]))
story.append(pricing)

summary = Table([
    ["Subtotal", money(345000)],
    ["VAT (15%)", money(51750)],
    ["GRAND TOTAL — VAT INCLUSIVE", money(396750)],
], colWidths=[101*mm, 55*mm])
summary.setStyle(TableStyle([
    ("ALIGN", (0, 0), (-1, -1), "RIGHT"),
    ("FONTNAME", (0, 0), (-1, 1), "Helvetica"),
    ("FONTNAME", (0, 2), (-1, 2), "Helvetica-Bold"),
    ("FONTSIZE", (0, 0), (-1, -1), 10),
    ("TEXTCOLOR", (0, 2), (-1, 2), colors.white),
    ("BACKGROUND", (0, 2), (-1, 2), TEAL),
    ("LINEABOVE", (0, 0), (-1, 0), 0.6, colors.HexColor("#9AABAD")),
    ("TOPPADDING", (0, 0), (-1, -1), 6),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
]))
story.append(summary)

story.append(Paragraph("Benefits to Rafam General Trading", styles["Section"]))
benefits = (
    "• A cohesive and credible brand identity that improves customer recognition.<br/>"
    "• A professional online presence that makes the company easier to discover and contact.<br/>"
    "• Accurate, real-time inventory control that reduces stock-outs, losses, and manual-record errors.<br/>"
    "• Clear operational reports to support purchasing, sales, and business decisions.<br/>"
    "• Staff training and three months of post-launch technical support."
)
story.append(Paragraph(benefits, styles["Body"]))

story.append(Paragraph("Payment Terms", styles["Section"]))
terms = Table([
    ["50% advance payment", money(198375)],
    ["30% after website and ERP demonstration", money(119025)],
    ["20% on final delivery and acceptance", money(79350)],
], colWidths=[106*mm, 50*mm])
terms.setStyle(TableStyle([
    ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#C9D4D6")),
    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F7FAFA")),
    ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
    ("FONTSIZE", (0, 0), (-1, -1), 9.5),
    ("ALIGN", (1, 0), (1, -1), "RIGHT"),
    ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ("TOPPADDING", (0, 0), (-1, -1), 6),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
]))
story.append(terms)
story.append(Spacer(1, 11*mm))
story.append(Paragraph("Authorized by: ________________________________    Date: __________________", styles["Body"]))

doc.build(story)
print(OUTPUT)
