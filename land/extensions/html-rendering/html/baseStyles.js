// ─────────────────────────────────────────────────
// Shared CSS building blocks for HTML renderers
//
// Import the pieces you need:
//   import { baseStyles, backNavStyles } from ...
//   <style>${baseStyles}${backNavStyles}
//   ... page-specific CSS here ...
//   </style>
// ─────────────────────────────────────────────────

// ─── Core: variables, reset, gradient, orbs, keyframes, container ───

export const baseStyles = `
:root {
  --glass-water-rgb: 115, 111, 230;
  --glass-alpha: 0.28;
  --glass-alpha-hover: 0.38;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
}

html, body {
  background: #736fe6;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
  min-height: 100dvh;
  padding: 20px;
  color: #1a1a1a;
  position: relative;
  overflow-x: hidden;
  touch-action: manipulation;
}

body::before,
body::after {
  content: '';
  position: fixed;
  border-radius: 50%;
  opacity: 0.08;
  animation: float 20s infinite ease-in-out;
  pointer-events: none;
}

body::before {
  width: 600px; height: 600px;
  background: white;
  top: -300px; right: -200px;
  animation-delay: -5s;
}

body::after {
  width: 400px; height: 400px;
  background: white;
  bottom: -200px; left: -100px;
  animation-delay: -10s;
}

@keyframes float {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  50% { transform: translateY(-30px) rotate(5deg); }
}

@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(30px); }
  to { opacity: 1; transform: translateY(0); }
}

.container {
  max-width: 900px;
  margin: 0 auto;
  position: relative;
  z-index: 1;
}
`;

// ─── Pill-shaped back navigation buttons ───

export const backNavStyles = `
.back-nav {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
  flex-wrap: wrap;
  animation: fadeInUp 0.5s ease-out both;
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px;
  background: rgba(115, 111, 230, var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  color: white;
  text-decoration: none;
  border-radius: 980px;
  font-weight: 600;
  font-size: 14px;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  position: relative;
  overflow: hidden;
}

.back-link::before {
  content: "";
  position: absolute;
  inset: -40%;
  background: radial-gradient(120% 60% at 0% 0%, rgba(255, 255, 255, 0.35), transparent 60%);
  opacity: 0;
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.back-link:hover {
  background: rgba(115, 111, 230, var(--glass-alpha-hover));
  transform: translateY(-1px);
}

.back-link:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}
`;

// ─── Glass header panel (title bar with h1) ───

export const glassHeaderStyles = `
.header {
  position: relative;
  overflow: hidden;
  background: rgba(115, 111, 230, var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px;
  padding: 32px;
  margin-bottom: 24px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  color: white;
  animation: fadeInUp 0.6s ease-out 0.1s both;
}

.header::before {
  content: "";
  position: absolute;
  inset: -40%;
  background: radial-gradient(120% 60% at 0% 0%, rgba(255, 255, 255, 0.35), transparent 60%);
  opacity: 0;
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.header:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

.header h1 {
  font-size: 28px;
  font-weight: 600;
  color: white;
  margin-bottom: 8px;
  line-height: 1.3;
  letter-spacing: -0.5px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.header h1 a {
  color: white;
  text-decoration: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.3);
  transition: all 0.2s;
}

.header h1 a:hover {
  border-bottom-color: white;
  text-shadow: 0 0 12px rgba(255, 255, 255, 0.8);
}

.message-count {
  display: inline-block;
  padding: 6px 14px;
  background: rgba(255, 255, 255, 0.25);
  color: white;
  border-radius: 980px;
  font-size: 14px;
  font-weight: 600;
  margin-left: 12px;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

.header-subtitle {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.9);
  margin-bottom: 8px;
  font-weight: 400;
  line-height: 1.5;
}
`;

// ─── Glass note/item cards with color variants ───

export const glassCardStyles = `
.notes-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.note-card {
  --card-rgb: 115, 111, 230;
  position: relative;
  background: rgba(var(--card-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  color: white;
  overflow: hidden;
}

.note-card::before {
  content: "";
  position: absolute;
  inset: -40%;
  background: radial-gradient(120% 60% at 0% 0%, rgba(255, 255, 255, 0.35), transparent 60%);
  opacity: 0;
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.note-card:hover {
  background: rgba(var(--card-rgb), var(--glass-alpha-hover));
  transform: translateY(-2px);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
}

.note-card:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

/* ── Color variants ── */
.glass-default  { --card-rgb: 115, 111, 230; }
.glass-green    { --card-rgb: 72, 187, 120;  }
.glass-red      { --card-rgb: 200, 80, 80;   }
.glass-blue     { --card-rgb: 80, 130, 220;  }
.glass-cyan     { --card-rgb: 56, 189, 210;  }
.glass-gold     { --card-rgb: 200, 170, 50;  }
.glass-purple   { --card-rgb: 155, 100, 220; }
.glass-pink     { --card-rgb: 210, 100, 160; }
.glass-orange   { --card-rgb: 220, 140, 60;  }
.glass-emerald  { --card-rgb: 52, 190, 130;  }
.glass-teal     { --card-rgb: 60, 170, 180;  }
.glass-indigo   { --card-rgb: 100, 100, 210; }

.note-content {
  margin-bottom: 12px;
}

.note-meta {
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.2);
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
  line-height: 1.8;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.note-meta a {
  color: white;
  text-decoration: none;
  font-weight: 500;
  border-bottom: 1px solid rgba(255, 255, 255, 0.3);
  transition: all 0.2s;
}

.note-meta a:hover {
  border-bottom-color: white;
  text-shadow: 0 0 12px rgba(255, 255, 255, 0.8);
}

.meta-separator {
  color: rgba(255, 255, 255, 0.5);
}
`;

// ─── Empty state glass panel ───

export const emptyStateStyles = `
.empty-state {
  position: relative;
  overflow: hidden;
  background: rgba(115, 111, 230, var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px;
  padding: 60px 40px;
  text-align: center;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  color: white;
  animation: fadeInUp 0.6s ease-out 0.2s both;
}

.empty-state::before {
  content: "";
  position: absolute;
  inset: -40%;
  background: radial-gradient(120% 60% at 0% 0%, rgba(255, 255, 255, 0.35), transparent 60%);
  opacity: 0;
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.empty-state:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

.empty-state-icon {
  font-size: 64px;
  margin-bottom: 16px;
  filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.2));
}

.empty-state-text {
  font-size: 20px;
  color: white;
  margin-bottom: 8px;
  font-weight: 600;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.empty-state-subtext {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.85);
}
`;

// ─── Glass card (reusable panel with gradient overlay) ───

export const glassCardPanelStyles = `
.glass-card {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px;
  padding: 28px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  margin-bottom: 24px;
  animation: fadeInUp 0.6s ease-out both;
  position: relative;
  overflow: visible;
}
.glass-card > * { position: relative; z-index: 1; }
.glass-card::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.05));
  pointer-events: none;
}
.glass-card h2 {
  font-size: 18px;
  font-weight: 600;
  color: white;
  margin-bottom: 16px;
  letter-spacing: -0.3px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}
`;

// ─── Glass form inputs and buttons ───

export const glassFormStyles = `
.glass-input {
  padding: 12px 16px;
  font-size: 14px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  color: white;
  font-family: inherit;
  transition: all 0.3s;
  width: 100%;
}
.glass-input::placeholder { color: rgba(255, 255, 255, 0.4); }
.glass-input:focus {
  outline: none;
  border-color: rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.15);
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.1);
}
.glass-select {
  padding: 10px 14px;
  font-size: 14px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.1);
  color: white;
  font-family: inherit;
  cursor: pointer;
  appearance: none;
}
.glass-select option { background: #2d2b70; color: white; }
.glass-btn-save {
  padding: 10px 20px;
  border-radius: 10px;
  border: 1px solid rgba(72, 187, 120, 0.4);
  background: rgba(72, 187, 120, 0.2);
  color: rgba(72, 187, 120, 0.9);
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}
.glass-btn-save:hover {
  background: rgba(72, 187, 120, 0.3);
  border-color: rgba(72, 187, 120, 0.6);
}
.glass-btn-danger {
  padding: 10px 20px;
  border-radius: 10px;
  border: 1px solid rgba(239, 68, 68, 0.3);
  background: rgba(239, 68, 68, 0.15);
  color: rgba(239, 68, 68, 0.8);
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}
.glass-btn-danger:hover {
  background: rgba(239, 68, 68, 0.25);
  border-color: rgba(239, 68, 68, 0.5);
}
`;

// ─── Stat grid (energy, values, metrics) ───

export const statGridStyles = `
.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 14px;
}
.stat-item {
  padding: 18px 20px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 14px;
  text-align: center;
  position: relative;
  overflow: hidden;
}
.stat-item::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.08), transparent);
  pointer-events: none;
}
.stat-label {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: rgba(255, 255, 255, 0.6);
  margin-bottom: 6px;
}
.stat-value {
  font-size: 28px;
  font-weight: 700;
  color: white;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}
.stat-sub {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  margin-top: 4px;
}
`;

// ─── Status message bar ───

export const statusBarStyles = `
.status-bar {
  display: none;
  padding: 10px 16px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 500;
  margin-top: 10px;
  text-align: center;
}
`;

// ─── Base responsive breakpoints ───

export const responsiveBase = `
@media (max-width: 640px) {
  body { padding: 16px; }
  .header { padding: 24px 20px; }
  .header h1 { font-size: 24px; }
  .message-count { display: block; margin-left: 0; margin-top: 8px; width: fit-content; }
  .note-card { padding: 20px 16px; }
  .back-nav { flex-direction: column; }
  .back-link { width: 100%; justify-content: center; }
  .empty-state { padding: 40px 24px; }
}

@media (min-width: 641px) and (max-width: 1024px) {
  .container { max-width: 700px; }
}
`;
