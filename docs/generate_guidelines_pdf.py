#!/usr/bin/env python3
"""Generate docs/MR-Database-Tool-Guidelines.pdf"""

from pathlib import Path

from fpdf import FPDF

OUT = Path(__file__).with_name("MR-Database-Tool-Guidelines.pdf")


class PDF(FPDF):
    def header(self):
        if self.page_no() == 1:
            return
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(100, 100, 100)
        self.cell(0, 8, "MR Database Tool - Guidelines & Deploy Guide", align="C")
        self.ln(10)
        self.set_text_color(0, 0, 0)

    def footer(self):
        self.set_y(-15)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(120, 120, 120)
        self.cell(0, 10, f"Page {self.page_no()}/{{nb}}", align="C")


def main() -> None:
    pdf = PDF(format="A4")
    pdf.alias_nb_pages()
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.set_left_margin(16)
    pdf.set_right_margin(16)
    pdf.add_page()

    def h1(text: str) -> None:
        pdf.ln(3)
        pdf.set_font("Helvetica", "B", 15)
        pdf.multi_cell(0, 7, text)
        pdf.ln(1)

    def h2(text: str) -> None:
        pdf.ln(2)
        pdf.set_font("Helvetica", "B", 12)
        pdf.multi_cell(0, 6, text)
        pdf.ln(1)

    def body(text: str) -> None:
        pdf.set_font("Helvetica", "", 10)
        pdf.multi_cell(0, 5, text)
        pdf.ln(1)

    def bullet(text: str) -> None:
        pdf.set_font("Helvetica", "", 10)
        pdf.multi_cell(0, 5, f"- {text}")

    def numbered(i: int, text: str) -> None:
        pdf.set_font("Helvetica", "", 10)
        pdf.multi_cell(0, 5, f"{i}. {text}")

    def code(text: str) -> None:
        pdf.set_font("Courier", "", 8)
        pdf.set_fill_color(245, 245, 245)
        pdf.multi_cell(0, 4, text, fill=True)
        pdf.ln(2)

    def table(headers: list[str], rows: list[list[str]], widths: list[float]) -> None:
        pdf.set_font("Helvetica", "B", 8)
        pdf.set_fill_color(30, 79, 216)
        pdf.set_text_color(255, 255, 255)
        for i, header in enumerate(headers):
            pdf.cell(widths[i], 6, header, border=1, fill=True)
        pdf.ln()
        pdf.set_text_color(0, 0, 0)
        pdf.set_font("Helvetica", "", 7.5)
        fill = False
        for row in rows:
            pdf.set_fill_color(248, 248, 248)
            # Wrap-ish: use multi_cell manually is complex; truncate long cells.
            for i, cell in enumerate(row):
                text = str(cell)
                max_chars = max(12, int(widths[i] / 1.7))
                if len(text) > max_chars:
                    text = text[: max_chars - 3] + "..."
                pdf.cell(widths[i], 5.5, text, border=1, fill=fill)
            pdf.ln()
            fill = not fill
        pdf.ln(2)

    # Title
    pdf.set_font("Helvetica", "B", 20)
    pdf.multi_cell(0, 9, "MR Database Tool")
    pdf.set_font("Helvetica", "B", 13)
    pdf.multi_cell(0, 7, "Guidelines & Deploy Guide")
    pdf.ln(2)
    body(
        "Team reference: application guidelines (MR Database Source List) "
        "and DigitalOcean Droplet deployment steps."
    )
    body("Staging example: https://stg.tkbaazibangladesh.com")
    body("Stack: React (Vite) + Express + Prisma + MySQL + Nginx + PM2 + Certbot")

    # Part 1
    h1("Part 1 - Application Guideline")
    h2("1.1 Purpose")
    body(
        "This tool follows the TK BDT Master Reports workbook structure. "
        "Weekly reporting uses source sheets plus a per-week detail sheet and summary KPIs."
    )

    h2("1.2 Main tabs / directories")
    table(
        ["Directory / Tab", "Role", "Notes"],
        [
            ["Week Detail (e.g. 2026W26)", "Per-week commission detail", "Week dropdown selects data"],
            ["Aff RawW", "Source - Aff Performance", "Manual from BO"],
            ["Player RawW", "Source - Player Performance", "Manual from BO"],
            ["System Comm Raw", "Source - Finance", "Manual weekly from BO"],
            ["Weekly Summary", "KPI aggregates ALL weeks", "Not filtered by week dropdown"],
            ["Paid Comm", "Paid affiliates only", "Status = Paid from Week Detail"],
            ["Aff SU", "Affiliate sign-ups", "SU Month / New Sign Up"],
            ["Business Raw Weekly", "Business metrics", "Weekly Summary ratios"],
        ],
        [58, 55, 65],
    )

    h2("1.3 Week Detail")
    body("Editable (Admin): Status, Adjustment, Last Week Negative Carry Over.")
    body("Status toggle: Paid / Unpaid. Blank = Unpaid. Only Paid rows appear in Paid Comm.")
    table(
        ["Column", "Source / Computation"],
        [
            ["SU MONTH", "From Aff SU (SU Date)"],
            ["Week", "Manual / selected week"],
            ["Affiliate Username", "Aff SU + Aff Raw"],
            ["Status", "Paid or Unpaid (default Unpaid)"],
            ["Adjustment", "Manual"],
            ["Final Commission", "System Comm + Adjustment"],
            ["Difference", "Calculated - System Commission"],
            ["System Commission", "SUMIFS System Comm Raw"],
            ["Calculated Commission", "FINAL NET x Comm %"],
            ["Comm %", "AP>0 and FINAL NET>1 => 50% (brand-specific)"],
            ["Last Week Commission", "Previous week tab"],
            ["AP(TO>0)", "Aff RawW"],
            ["AP Qualified (TO>1000)", "Player RawW turnover > 1000"],
            ["Gross Revenue", "Aff RawW Total Profit&Loss"],
            ["Deduction", "If Gross>0 => Gross x 18%, else 0"],
            ["Aff Raw Bonus / VIP", "Aff RawW"],
            ["Net Profit", "TPL - Deduction - Bonus - VIP"],
            ["FINAL NET", "If NCF+NetProfit>0 => 0; else sum"],
            ["Last/Next Week NCF", "Carry-over rules from guideline"],
        ],
        [55, 123],
    )

    h2("1.4 Weekly Summary (KPI)")
    body(
        "Shows all imported weeks (one row per week). Includes Month, New Sign Up, Total Aff, "
        "Active Affiliates, Dormant Aff, Active Players, Deposit, Turnover split, "
        "Gross/Deduction/Bonus/VIP/Net, Commission, and ratios vs Business Raw."
    )

    h2("1.5 Weekly upload workflow")
    numbered(1, "Admin uploads one weekly workbook on Week Detail.")
    numbered(
        2,
        "Pre-selected: week sheet + Aff RawW, Player RawW, System Comm Raw, Aff SU, Business Raw.",
    )
    numbered(3, "Paid Comm and Weekly Summary are usually derived.")
    numbered(4, "Target week in upload modal is typeable for new weeks (e.g. 2026W28).")
    numbered(5, "Frontpage week dropdown persists weeks from the database after refresh.")

    h2("1.6 Roles")
    table(
        ["Role", "Access"],
        [
            ["Admin", "Full access including import/export and Status/Adjustment edits"],
            ["Viewer", "Read-only"],
        ],
        [35, 143],
    )

    # Part 2
    h1("Part 2 - DigitalOcean Droplet Deploy Guide")
    h2("2.0 Checklist")
    for item in [
        "DigitalOcean account + Droplet",
        "Domain on Namecheap/Cloudflare",
        "GitHub access (PAT if private)",
        "SSH or Droplet Console",
    ]:
        bullet(item)

    h2("2.1 Create Droplet")
    table(
        ["Setting", "Choice"],
        [
            ["Region", "Singapore (or nearest)"],
            ["Image", "Ubuntu 24.04 LTS"],
            ["Plan", "Basic, 2GB RAM min (4GB better)"],
            ["Auth", "SSH key preferred"],
            ["Hostname", "e.g. react-MrDatabaseTool-test"],
        ],
        [45, 133],
    )
    body("Copy Droplet IPv4 after create (example: 146.190.105.28).")

    h2("2.2 DNS")
    body("Cloudflare: A record Name=stg, Content=Droplet IP, Proxy=DNS only (grey) first.")
    body("Namecheap-only: A record Host=stg, Value=Droplet IP.")
    body("Cloudflare Error 521 = origin not responding. Test http://DROPLET_IP/login first.")

    h2("2.3 SSH")
    code("ssh root@YOUR_DROPLET_IP")

    h2("2.4 Base packages")
    code("apt update && apt upgrade -y\napt install -y git curl nginx mysql-server ufw")

    h2("2.5 Node.js 22 (required)")
    body("Do not use Ubuntu Node 18. Prisma needs Node 20.19+ / 22.12+ / 24+.")
    code(
        "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -\n"
        "apt install -y nodejs\n"
        "node -v && npm -v"
    )

    h2("2.6 Firewall")
    code("ufw allow OpenSSH\nufw allow 'Nginx Full'\nufw --force enable")

    h2("2.7 MySQL")
    code("sudo mysql")
    code(
        "CREATE DATABASE mr_database_tool CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n"
        "CREATE USER 'mr_user'@'localhost' IDENTIFIED BY 'YOUR_STRONG_PASSWORD';\n"
        "GRANT ALL PRIVILEGES ON mr_database_tool.* TO 'mr_user'@'localhost';\n"
        "FLUSH PRIVILEGES;\n"
        "EXIT;"
    )
    body("Optional: ALTER USER ... IDENTIFIED WITH mysql_native_password BY '...'")

    h2("2.8 Clone from GitHub")
    code(
        "mkdir -p /var/www && cd /var/www\n"
        "git clone https://github.com/YOUR_USERNAME/MR-Database-Tool.git\n"
        "cd MR-Database-Tool"
    )
    body("Private repo: use Personal Access Token as password (not GitHub account password).")

    h2("2.9 Install dependencies")
    code("cd /var/www/MR-Database-Tool\nnpm run install:all")

    h2("2.10 Backend .env")
    code(
        "PORT=4000\n"
        'DATABASE_URL="mysql://mr_user:YOUR_STRONG_PASSWORD@localhost:3306/mr_database_tool"\n'
        "DATABASE_HOST=localhost\n"
        "DATABASE_PORT=3306\n"
        "DATABASE_USER=mr_user\n"
        "DATABASE_PASSWORD=YOUR_STRONG_PASSWORD\n"
        "DATABASE_NAME=mr_database_tool\n"
        "JWT_SECRET=long-random-secret-change-me\n"
        "CORS_ORIGIN=https://stg.yourdomain.com"
    )

    h2("2.11 Migrate, seed, build API")
    code(
        "cd /var/www/MR-Database-Tool/backend\n"
        "npx prisma generate\n"
        "npx prisma migrate deploy\n"
        "npm run db:seed\n"
        "npm run build"
    )
    table(
        ["Role", "Email", "Password"],
        [
            ["Admin", "admin@mrtool.local", "Admin123!"],
            ["Viewer", "viewer@mrtool.local", "Viewer123!"],
        ],
        [35, 75, 68],
    )

    h2("2.12 PM2")
    code(
        "npm install -g pm2\n"
        "cd /var/www/MR-Database-Tool/backend\n"
        "pm2 start dist/index.js --name mr-api\n"
        "pm2 save\n"
        "pm2 startup\n"
        "pm2 status\n"
        "curl http://127.0.0.1:4000/api/health"
    )

    h2("2.13 Build frontend")
    code("cd /var/www/MR-Database-Tool/frontend\nnpm run build")

    h2("2.14 Nginx")
    code("nano /etc/nginx/sites-available/mr-database-tool")
    code(
        "server {\n"
        "    listen 80;\n"
        "    server_name stg.yourdomain.com;\n"
        "    root /var/www/MR-Database-Tool/frontend/dist;\n"
        "    index index.html;\n"
        "    location /api/ {\n"
        "        proxy_pass http://127.0.0.1:4000/api/;\n"
        "        proxy_http_version 1.1;\n"
        "        proxy_set_header Host $host;\n"
        "        proxy_set_header X-Real-IP $remote_addr;\n"
        "        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n"
        "        proxy_set_header X-Forwarded-Proto $scheme;\n"
        "        client_max_body_size 50M;\n"
        "    }\n"
        "    location / {\n"
        "        try_files $uri $uri/ /index.html;\n"
        "    }\n"
        "}"
    )
    code(
        "ln -sf /etc/nginx/sites-available/mr-database-tool /etc/nginx/sites-enabled/\n"
        "rm -f /etc/nginx/sites-enabled/default\n"
        "nginx -t\n"
        "systemctl enable nginx\n"
        "systemctl restart nginx"
    )

    h2("2.15 Certbot (HTTPS)")
    body("Use Cloudflare grey cloud first. Domain must already open on HTTP.")
    code(
        "apt install -y certbot python3-certbot-nginx\n"
        "certbot --nginx -d stg.yourdomain.com"
    )
    body("Then set CORS_ORIGIN=https://stg.yourdomain.com and run: pm2 restart mr-api")
    body("Cloudflare SSL mode after HTTPS: Full or Full (strict).")

    h2("2.16 Updates from GitHub")
    code(
        "cd /var/www/MR-Database-Tool\n"
        "git pull\n"
        "npm run install:all\n"
        "cd backend\n"
        "npx prisma generate\n"
        "npx prisma migrate deploy\n"
        "npm run build\n"
        "pm2 restart mr-api\n"
        "cd ../frontend\n"
        "npm run build\n"
        "systemctl reload nginx"
    )

    h2("2.17 Troubleshooting")
    table(
        ["Symptom", "Fix"],
        [
            ["Prisma Node version too old", "Install Node 22"],
            ["git invalid username or token", "Use PAT, not GitHub password"],
            ["mysql command not found", "apt install mysql-server"],
            ["P1000 auth failed", "Fix .env password (not placeholder)"],
            ["Seed RSA / pool timeout", "mysql_native_password for mr_user"],
            ["Nginx sites-available missing", "apt install nginx first"],
            ["Cloudflare 521", "Origin down / wrong IP; grey cloud"],
            ["Works on IP not domain", "Fix DNS A record to Droplet IP"],
        ],
        [70, 108],
    )

    h2("2.18 Useful commands")
    code(
        "pm2 status\n"
        "pm2 logs mr-api\n"
        "pm2 restart mr-api\n"
        "systemctl status nginx\n"
        "nginx -t\n"
        "curl http://127.0.0.1:4000/api/health\n"
        "curl -I http://127.0.0.1\n"
        "curl -4 ifconfig.me"
    )

    h2("2.19 Security")
    bullet("Strong DB password and JWT_SECRET")
    bullet("Change default seed passwords ASAP")
    bullet("Never commit .env")
    bullet("Keep Droplet updated: apt update && apt upgrade -y")

    h1("Part 3 - Staging reference")
    table(
        ["Item", "Value"],
        [
            ["Domain", "stg.tkbaazibangladesh.com"],
            ["Example Droplet IP", "146.190.105.28"],
            ["App path", "/var/www/MR-Database-Tool"],
            ["API process", "pm2 name mr-api"],
            ["Nginx site", "/etc/nginx/sites-available/mr-database-tool"],
            ["Markdown copy", "docs/DEPLOY-DROPLET.md"],
            ["Word copy", "docs/MR-Database-Tool-Guidelines.docx"],
        ],
        [50, 128],
    )

    pdf.output(str(OUT))
    print(f"Wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
