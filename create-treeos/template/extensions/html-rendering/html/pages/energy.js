import { page } from "../layout.js";

export function renderEnergy({ userId, user, energyAmount, additionalEnergy, plan, planExpiresAt, llmConnections, mainAssignment, rawIdeaAssignment, activeConn, hasLlm, connectionCount, isBasic, qs }) {
  const css = `
body {
  color: white;
}


  .glass-card > * {
    position: relative;
    z-index: 1;
  }


  /* =========================================================
     GLASS CARDS
     ========================================================= */
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


  /* =========================================================
     ENERGY STATUS
     ========================================================= */
  .energy-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 14px;
  }

  .energy-stat {
    padding: 18px 20px;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 14px;
    text-align: center;
    position: relative;
    overflow: hidden;
  }

  .energy-stat::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.08), transparent);
    pointer-events: none;
  }

  .energy-stat-label {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: rgba(255, 255, 255, 0.6);
    margin-bottom: 6px;
  }

  .energy-stat-value {
    font-size: 28px;
    font-weight: 700;
    color: white;
    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }

  .energy-stat-sub {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
    margin-top: 4px;
  }

  .energy-stat.plan-basic {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.2);
  }

  .energy-stat.plan-standard {
    background: linear-gradient(135deg, rgba(96, 165, 250, 0.2), rgba(37, 99, 235, 0.2));
    border-color: rgba(96, 165, 250, 0.3);
  }

  .energy-stat.plan-premium {
    background: linear-gradient(135deg, rgba(168, 85, 247, 0.2), rgba(124, 58, 237, 0.2));
    border-color: rgba(168, 85, 247, 0.3);
  }

  .energy-stat.plan-god {
    background: linear-gradient(135deg, rgba(250, 204, 21, 0.2), rgba(245, 158, 11, 0.2));
    border-color: rgba(250, 204, 21, 0.3);
  }

  /* =========================================================
     PLAN CARDS
     ========================================================= */
  .plan-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 14px;
  }

  .plan-box {
    padding: 24px 20px;
    border-radius: 14px;
    text-align: center;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative;
    overflow: hidden;
  }

  .plan-box::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    transition: all 0.3s;
  }

  .plan-box[data-plan="basic"] {
    background: rgba(255, 255, 255, 0.2);
    border: 2px solid rgba(255, 255, 255, 0.18);
  }
  .plan-box[data-plan="basic"]::before {
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.06), transparent);
  }

  .plan-box[data-plan="standard"] {
    background: rgba(96, 165, 250, 0.08);
    border: 2px solid rgba(96, 165, 250, 0.25);
  }
  .plan-box[data-plan="standard"]::before {
    background: linear-gradient(180deg, rgba(96, 165, 250, 0.1), transparent);
  }

  .plan-box[data-plan="premium"] {
    background: rgba(168, 85, 247, 0.08);
    border: 2px solid rgba(168, 85, 247, 0.25);
  }
  .plan-box[data-plan="premium"]::before {
    background: linear-gradient(180deg, rgba(168, 85, 247, 0.1), transparent);
  }

  .plan-box:hover:not(.disabled) {
    transform: translateY(-4px);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.15);
  }

  .plan-box[data-plan="standard"]:hover:not(.disabled) {
    background: rgba(96, 165, 250, 0.16);
    border-color: rgba(96, 165, 250, 0.4);
  }

  .plan-box[data-plan="premium"]:hover:not(.disabled) {
    background: rgba(168, 85, 247, 0.16);
    border-color: rgba(168, 85, 247, 0.4);
  }

  .plan-box.selected {
    transform: translateY(-4px);
    box-shadow: 0 0 0 3px rgba(72, 187, 178, 0.6), 0 8px 28px rgba(0, 0, 0, 0.15), 0 0 30px rgba(72, 187, 178, 0.15);
  }

  .plan-box[data-plan="standard"].selected {
    border-color: rgba(72, 187, 178, 0.9);
    background: rgba(96, 165, 250, 0.18);
  }

  .plan-box[data-plan="premium"].selected {
    border-color: rgba(72, 187, 178, 0.9);
    background: rgba(168, 85, 247, 0.18);
  }

  .plan-box.disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

 .plan-box.current-plan {
    border-color: rgba(255, 255, 255, 0.6);
    border-width: 3px;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.15), 0 0 20px rgba(255, 255, 255, 0.08);
  }

  .plan-name {
    font-size: 20px;
    font-weight: 700;
    color: white;
    margin-bottom: 6px;
  }

  .plan-price {
    font-size: 24px;
    font-weight: 700;
    color: white;
    margin-bottom: 4px;
  }

  .plan-period {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.55);
  }

  .plan-current-tag {
    display: inline-block;
    margin-top: 10px;
    padding: 4px 12px;
    border-radius: 980px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    background: rgba(255, 255, 255, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.25);
  }

  .plan-features {
    margin-top: 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .plan-feature {
    font-size: 13px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.75);
  }

  .plan-feature.dim { color: rgba(255, 255, 255, 0.4); }

  .plan-feature.highlight {
    color: rgba(72, 187, 178, 0.95);
    font-weight: 600;
  }

  .plan-renew-note {
    margin-top: 14px;
    text-align: center;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.55);
    font-style: italic;
  }

  /* =========================================================
     ENERGY BUY
     ========================================================= */
  .energy-btns {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .energy-buy-btn {
    padding: 12px 20px;
    border-radius: 980px;
    border: 1px solid rgba(255, 255, 255, 0.28);
    background: rgba(var(--glass-water-rgb), var(--glass-alpha));
    backdrop-filter: blur(22px) saturate(140%);
    -webkit-backdrop-filter: blur(22px) saturate(140%);
    color: white;
    font-weight: 600;
    font-size: 14px;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12),
      inset 0 1px 0 rgba(255, 255, 255, 0.25);
    position: relative;
    overflow: hidden;
  }

  .energy-buy-btn::before {
    content: "";
    position: absolute;
    inset: -40%;
    background:
      radial-gradient(120% 60% at 0% 0%, rgba(255, 255, 255, 0.35), transparent 60%),
      linear-gradient(120deg, transparent 30%, rgba(255, 255, 255, 0.25), transparent 70%);
    opacity: 0;
    transform: translateX(-30%) translateY(-10%);
    transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
    pointer-events: none;
  }

  .energy-buy-btn:hover {
    background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
    transform: translateY(-2px);
  }

  .energy-buy-btn:hover::before {
    opacity: 1;
    transform: translateX(30%) translateY(10%);
  }

  .energy-buy-btn:active {
    background: rgba(var(--glass-water-rgb), 0.45);
    transform: translateY(0);
  }

  /* =========================================================
     CHECKOUT
     ========================================================= */
  .checkout-summary {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .checkout-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 16px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 12px;
    transition: background 0.2s;
  }

  .checkout-row:hover {
    background: rgba(255, 255, 255, 0.12);
  }

  .checkout-row-left {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: 1;
    min-width: 0;
  }

  .checkout-row-icon {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    flex-shrink: 0;
  }

  .checkout-row-icon.plan-icon {
    background: rgba(168, 85, 247, 0.2);
    border: 1px solid rgba(168, 85, 247, 0.3);
  }

  .checkout-row-icon.energy-icon {
    background: rgba(250, 204, 21, 0.2);
    border: 1px solid rgba(250, 204, 21, 0.3);
  }

  .checkout-row-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .checkout-row-label {
    font-size: 14px;
    font-weight: 600;
    color: white;
  }

  .checkout-row-desc {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
  }

  .checkout-row-right {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
  }

  .checkout-row-value {
    font-size: 16px;
    font-weight: 700;
    color: white;
  }

  .checkout-remove {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: rgba(239, 68, 68, 0.15);
    color: rgba(255, 255, 255, 0.7);
    font-size: 14px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
    line-height: 1;
  }

  .checkout-remove:hover {
    background: rgba(239, 68, 68, 0.35);
    border-color: rgba(239, 68, 68, 0.5);
    color: white;
  }

  .checkout-divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.1);
    margin: 4px 0;
  }

  .checkout-total {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 18px 20px;
    background: linear-gradient(135deg, rgba(72, 187, 178, 0.2), rgba(56, 163, 155, 0.15));
    border: 1px solid rgba(72, 187, 178, 0.35);
    border-radius: 14px;
  }

  .checkout-total-label {
    font-size: 16px;
    font-weight: 600;
    color: white;
  }

  .checkout-total-value {
    font-size: 28px;
    font-weight: 700;
    color: white;
    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }

  .checkout-btn {
    width: 100%;
    padding: 18px;
    border-radius: 980px;
    border: 1px solid rgba(72, 187, 178, 0.5);
    background: linear-gradient(135deg, rgba(72, 187, 178, 0.4), rgba(56, 163, 155, 0.35));
    backdrop-filter: blur(22px) saturate(140%);
    -webkit-backdrop-filter: blur(22px) saturate(140%);
    color: white;
    font-size: 17px;
    font-weight: 700;
    font-family: inherit;
    cursor: pointer;
    margin-top: 16px;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12),
      0 0 20px rgba(72, 187, 178, 0.1),
      inset 0 1px 0 rgba(255, 255, 255, 0.2);
    position: relative;
    overflow: hidden;
    letter-spacing: -0.2px;
  }

  .checkout-btn::before {
    content: "";
    position: absolute;
    inset: -40%;
    background:
      radial-gradient(120% 60% at 0% 0%, rgba(255, 255, 255, 0.35), transparent 60%),
      linear-gradient(120deg, transparent 30%, rgba(255, 255, 255, 0.25), transparent 70%);
    opacity: 0;
    transform: translateX(-30%) translateY(-10%);
    transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
    pointer-events: none;
  }

  .checkout-btn:hover {
    background: linear-gradient(135deg, rgba(72, 187, 178, 0.55), rgba(56, 163, 155, 0.5));
    transform: translateY(-2px);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18),
      0 0 30px rgba(72, 187, 178, 0.2);
  }

  .checkout-btn:hover::before {
    opacity: 1;
    transform: translateX(30%) translateY(10%);
  }

  .checkout-btn:active { transform: translateY(0); }

  .checkout-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    transform: none;
  }

  .checkout-btn:disabled:hover {
    background: linear-gradient(135deg, rgba(72, 187, 178, 0.4), rgba(56, 163, 155, 0.35));
    transform: none;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  }

  .checkout-legal {
    text-align: center;
    margin-top: 14px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.45);
    line-height: 1.5;
  }

  .checkout-legal-link {
    color: rgba(255, 255, 255, 0.7);
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
    transition: color 0.2s;
  }

  .checkout-legal-link:hover { color: white; }

  .checkout-note {
    text-align: center;
    margin-top: 10px;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.45);
    font-style: italic;
  }

  .checkout-empty {
    text-align: center;
    padding: 28px 20px;
    color: rgba(255, 255, 255, 0.4);
    font-style: italic;
    font-size: 14px;
    border: 2px dashed rgba(255, 255, 255, 0.12);
    border-radius: 14px;
  }

  /* =========================================================
     LLM SECTION
     ========================================================= */
  .llm-section-wrapper {
    position: relative;
  }

  .llm-section-wrapper.locked .llm-section-content {
    opacity: 0.2;
    pointer-events: none;
    filter: blur(2px);
  }

  .llm-upgrade-overlay {
    display: none;
    position: absolute;
    inset: 0;
    z-index: 5;
    border-radius: inherit;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 8px;
  }

  .llm-section-wrapper.locked .llm-upgrade-overlay {
    display: flex;
  }

  .llm-upgrade-text {
    font-size: 16px;
    font-weight: 600;
    color: white;
    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  .llm-upgrade-sub {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.7);
  }

  .llm-sub {
    font-size: 14px;
    color: rgba(255, 255, 255, 0.6);
    line-height: 1.5;
    margin-bottom: 16px;
  }

  .llm-toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    margin-bottom: 16px;
    padding: 14px 16px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 12px;
  }

  .llm-toggle-label {
    font-size: 14px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.8);
  }

  .glass-toggle {
    position: relative;
    width: 54px;
    height: 28px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.3);
    backdrop-filter: blur(18px);
    cursor: pointer;
    transition: all 0.25s ease;
    flex-shrink: 0;
  }

  .glass-toggle.active {
    background: rgba(72, 187, 178, 0.45);
    box-shadow: 0 0 16px rgba(72, 187, 178, 0.35);
  }

  .glass-toggle-knob {
    position: absolute;
    top: 4px;
    left: 4px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: white;
    transition: all 0.25s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .glass-toggle.active .glass-toggle-knob {
    left: 28px;
  }

  .llm-connected-badge {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    background: rgba(72, 187, 120, 0.15);
    border: 1px solid rgba(72, 187, 120, 0.3);
    border-radius: 10px;
    margin-bottom: 16px;
  }

  .llm-connected-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: rgba(72, 187, 120, 0.9);
    box-shadow: 0 0 8px rgba(72, 187, 120, 0.5);
    flex-shrink: 0;
  }

  .llm-connected-text {
    font-size: 13px;
    font-weight: 600;
    color: rgba(72, 187, 120, 0.9);
  }

  .llm-connected-detail {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.45);
    margin-left: auto;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 300px;
  }

  .llm-fields {
    display: flex;
    flex-direction: column;
    gap: 12px;
    transition: opacity 0.3s;
  }

  .llm-fields.disabled {
    opacity: 0.35;
    pointer-events: none;
  }

  .llm-field-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .llm-field-label {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: rgba(255, 255, 255, 0.55);
  }

  .llm-input {
    padding: 14px 16px;
    font-size: 15px;
    border-radius: 12px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    background: rgba(255, 255, 255, 0.15);
    color: white;
    font-family: inherit;
    font-weight: 500;
    transition: all 0.2s;
    width: 100%;
  }

  .llm-input::placeholder { color: rgba(255, 255, 255, 0.35); }

  .llm-input:focus {
    outline: none;
    border-color: rgba(255, 255, 255, 0.6);
    background: rgba(255, 255, 255, 0.25);
    box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.15);
    transform: translateY(-2px);
  }

  /* Custom dropdown (replaces native <select> to avoid iframe glitch on mobile) */
  .custom-select {
    position: relative;
    width: 100%;
  }
  .custom-select-trigger {
    padding: 8px 10px;
    font-size: 15px;
    border-radius: 12px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    background: rgba(255, 255, 255, 0.15);
    color: white;
    font-family: inherit;
    font-weight: 500;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    transition: border-color 0.2s, background 0.2s;
    -webkit-user-select: none;
    user-select: none;
  }
  .custom-select-trigger::after {
    content: "\u25BE";
    font-size: 12px;
    opacity: 0.6;
    flex-shrink: 0;
  }
  .custom-select.open .custom-select-trigger {
    border-color: rgba(255, 255, 255, 0.6);
    background: rgba(255, 255, 255, 0.25);
  }
  .custom-select.open .custom-select-trigger::after { content: "\u25B4"; }
  .custom-select-options {
    display: none;
    position: absolute;
    left: 0; right: 0;
    bottom: calc(100% + 4px);
    background: rgba(30, 20, 50, 0.97);
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 10px;
    overflow: hidden;
    z-index: 100;
    max-height: 220px;
    overflow-y: auto;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    box-shadow: 0 -4px 20px rgba(0,0,0,0.4);
  }
  .custom-select.open .custom-select-options { display: block; }
  .custom-select-option {
    padding: 10px 12px;
    font-size: 14px;
    color: rgba(255, 255, 255, 0.8);
    cursor: pointer;
    transition: background 0.15s;
  }
  .custom-select-option:hover,
  .custom-select-option:focus { background: rgba(255, 255, 255, 0.12); }
  .custom-select-option.selected {
    background: rgba(72, 187, 178, 0.2);
    color: white;
    font-weight: 600;
  }

  .llm-btn-row {
    display: flex;
    gap: 12px;
    margin-top: 4px;
  }

  .llm-save-btn,
  .llm-disconnect-btn {
    padding: 14px 24px;
    border-radius: 980px;
    border: 1px solid;
    color: white;
    font-weight: 600;
    font-size: 15px;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.3s;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12),
      inset 0 1px 0 rgba(255, 255, 255, 0.2);
    background: none;
  }

  .llm-save-btn {
    flex: 1;
    border-color: rgba(72, 187, 178, 0.4);
    background: rgba(72, 187, 178, 0.3);
  }

  .llm-save-btn:hover {
    background: rgba(72, 187, 178, 0.45);
    transform: translateY(-2px);
  }

  .llm-disconnect-btn {
    border-color: rgba(239, 68, 68, 0.4);
    background: rgba(239, 68, 68, 0.25);
  }

  .llm-disconnect-btn:hover {
    background: rgba(239, 68, 68, 0.4);
    transform: translateY(-2px);
  }

  .llm-status {
    margin-top: 10px;
    font-size: 13px;
    font-weight: 600;
    display: none;
  }

  /* =========================================================
     MODAL (Terms / Privacy)
     ========================================================= */
  .modal-overlay {
    display: none;
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    align-items: center;
    justify-content: center;
    padding: 20px;
  }

  .modal-overlay.show { display: flex; }

  .modal-container {
    width: 100%;
    max-width: 720px;
    height: 85vh;
    height: 85dvh;
    background: rgba(var(--glass-water-rgb), 0.35);
    backdrop-filter: blur(22px) saturate(140%);
    -webkit-backdrop-filter: blur(22px) saturate(140%);
    border-radius: 20px;
    border: 1px solid rgba(255, 255, 255, 0.28);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.15);
    flex-shrink: 0;
  }

  .modal-title {
    font-size: 16px;
    font-weight: 600;
    color: white;
  }

  .modal-close {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.25);
    background: rgba(255, 255, 255, 0.15);
    color: white;
    font-size: 18px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s;
    line-height: 1;
  }

  .modal-close:hover {
    background: rgba(255, 255, 255, 0.3);
  }

  .modal-body {
    flex: 1;
    overflow: hidden;
  }

  .modal-body iframe {
    width: 100%;
    height: 100%;
    border: none;
  }

  /* =========================================================
     RESPONSIVE
     ========================================================= */
  @media (max-width: 640px) {
    body { padding: 16px; }
    .container { max-width: 100%; }
    .glass-card { padding: 20px; }

    .energy-grid { grid-template-columns: 1fr; }
    .plan-grid { grid-template-columns: 1fr; }
    .energy-btns { flex-direction: column; }
    .energy-buy-btn { width: 100%; }
    .llm-btn-row { flex-direction: column; }
    .llm-save-btn, .llm-disconnect-btn { width: 100%; text-align: center; }
    .llm-connected-detail { max-width: 140px; }
    .modal-container { height: 90vh; height: 90dvh; border-radius: 16px; }
    .modal-overlay { padding: 10px; }
  }`;

  const body = `
<div class="container">

  <div class="back-nav">
    <a href="/api/v1/user/${userId}${qs}" class="back-link">\u2190 Back to Profile</a>
  </div>

  <!-- Energy Status -->
  <div class="glass-card" style="animation-delay: 0.1s;">
    <h2>\u26A1 Energy</h2>
    <div class="energy-grid">
      <div class="energy-stat">
        <div class="energy-stat-label">Plan Energy</div>
        <div class="energy-stat-value">${energyAmount}</div>
        <div class="energy-stat-sub">Resets every 24 hours</div>
      </div>
      <div class="energy-stat plan-${plan}">
        <div class="energy-stat-label">Current Plan</div>
        <div class="energy-stat-value" style="font-size: 22px; text-transform: capitalize;">${plan}</div>
        ${!isBasic && planExpiresAt ? '<div class="energy-stat-sub">Expires ' + new Date(planExpiresAt).toLocaleDateString() + "</div>" : ""}
      </div>
      <div class="energy-stat">
        <div class="energy-stat-label">Additional Energy</div>
        <div class="energy-stat-value">${additionalEnergy}</div>
        <div class="energy-stat-sub">Used after plan energy</div>
      </div>
    </div>
  </div>

  <!-- Plans -->
  <div class="glass-card" style="animation-delay: 0.15s;">
    <h2>\uD83D\uDCCB Plans</h2>
    <div class="plan-grid">
      <div class="plan-box disabled" data-plan="basic">
        <div class="plan-name">Basic</div>
        <div class="plan-price">Free</div>
        <div class="plan-period">350 daily energy</div>
        <div class="plan-features">
          <div class="plan-feature">No file uploads</div>
          <div class="plan-feature dim">Limited access</div>
        </div>
        ${plan === "basic" ? '<div class="plan-current-tag">Current Plan</div>' : ""}
      </div>
      <div class="plan-box" data-plan="standard">
        <div class="plan-name">Standard</div>
        <div class="plan-price">$20</div>
        <div class="plan-period">per 30 days</div>
        <div class="plan-features">
          <div class="plan-feature">1,500 daily energy</div>
          <div class="plan-feature">File uploads</div>
        </div>
        ${plan === "standard" ? '<div class="plan-current-tag">Current Plan</div>' : ""}
      </div>
      <div class="plan-box" data-plan="premium">
        <div class="plan-name">Premium</div>
        <div class="plan-price">$100</div>
        <div class="plan-period">per 30 days</div>
        <div class="plan-features">
          <div class="plan-feature">8,000 daily energy</div>
          <div class="plan-feature">Full access</div>
          <div class="plan-feature highlight">Offline LLM processing</div>
        </div>
        ${plan === "premium" ? '<div class="plan-current-tag">Current Plan</div>' : ""}
      </div>
    </div>
    <div class="plan-renew-note" id="planNote" style="display:none;"></div>
  </div>

  <!-- Buy Energy -->
  <div class="glass-card" style="animation-delay: 0.2s;">
    <h2>\uD83D\uDD25 Additional Energy</h2>
    <div style="font-size: 14px; color: rgba(255,255,255,0.55); margin-bottom: 16px;">Reserve energy \u2014 only used when your plan energy runs out.</div>
    <div class="energy-btns" id="energyBtns">
      <button class="energy-buy-btn" data-amount="100">+100</button>
      <button class="energy-buy-btn" data-amount="500">+500</button>
      <button class="energy-buy-btn" data-amount="1000">+1000</button>
      <button class="energy-buy-btn" id="customEnergyBtn">+Custom</button>
    </div>
    <div id="energyAdded" style="margin-top: 14px; font-size: 14px; color: rgba(255,255,255,0.6); display: none;">
      Added: <strong id="energyAddedVal" style="color: white;"></strong>
      <span style="margin-left: 8px; cursor: pointer; opacity: 0.6;" onclick="resetEnergy()">\u2715 Clear</span>
    </div>
  </div>

  <!-- Checkout -->
  <div class="glass-card" style="animation-delay: 0.25s;">
    <h2>\uD83D\uDCB3 Checkout</h2>
    <div id="checkoutContent">
      <div class="checkout-empty">Select a plan or add energy to continue</div>
    </div>
  </div>

  <!-- Custom LLM -->
  <div class="glass-card" style="animation-delay: 0.3s;">
    <h2>\uD83E\uDD16 Custom LLM Endpoints <span style="opacity:0.5;font-size:0.7em">(${connectionCount}/15)</span></h2>
    <div class="llm-section-wrapper">
      <div class="llm-section-content">
        <div class="llm-sub">Connect your own OpenAI API-compatible LLMs. Assign them to different areas below.</div>

        ${
          connectionCount > 0
            ? '<div style="display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap;">' +
              '<div style="flex:1;min-width:180px;">' +
              '<label class="llm-field-label" style="margin-bottom:4px;display:block;">Profile (Chat)</label>' +
              '<div class="custom-select" id="llmAssignMain" data-slot="main">' +
              '<div class="custom-select-trigger">' +
              (mainAssignment
                ? llmConnections
                    .filter(function (c) {
                      return c._id === mainAssignment;
                    })
                    .map(function (c) {
                      return c.name + " (" + c.model + ")";
                    })[0] || "None selected"
                : "None selected") +
              "</div>" +
              '<div class="custom-select-options">' +
              '<div class="custom-select-option' +
              (!mainAssignment ? " selected" : "") +
              '" data-value="">None</div>' +
              llmConnections
                .map(function (c) {
                  return (
                    '<div class="custom-select-option' +
                    (mainAssignment === c._id ? " selected" : "") +
                    '" data-value="' +
                    c._id +
                    '">' +
                    c.name +
                    " (" +
                    c.model +
                    ")</div>"
                  );
                })
                .join("") +
              "</div>" +
              "</div>" +
              "</div>" +
              '<div style="flex:1;min-width:180px;">' +
              '<label class="llm-field-label" style="margin-bottom:4px;display:block;">Raw Ideas</label>' +
              '<div class="custom-select" id="llmAssignRawIdea" data-slot="rawIdea">' +
              '<div class="custom-select-trigger">' +
              (rawIdeaAssignment
                ? llmConnections
                    .filter(function (c) {
                      return c._id === rawIdeaAssignment;
                    })
                    .map(function (c) {
                      return c.name + " (" + c.model + ")";
                    })[0] || "Uses main"
                : "Uses main") +
              "</div>" +
              '<div class="custom-select-options">' +
              '<div class="custom-select-option' +
              (!rawIdeaAssignment ? " selected" : "") +
              '" data-value="">Uses main</div>' +
              llmConnections
                .map(function (c) {
                  return (
                    '<div class="custom-select-option' +
                    (rawIdeaAssignment === c._id ? " selected" : "") +
                    '" data-value="' +
                    c._id +
                    '">' +
                    c.name +
                    " (" +
                    c.model +
                    ")</div>"
                  );
                })
                .join("") +
              "</div>" +
              "</div>" +
              "</div>" +
              "</div>"
            : ""
        }

        <div id="llmConnectionsList">
          ${
            connectionCount === 0
              ? '<div class="llm-empty-state" style="text-align:center;padding:18px 0;opacity:0.5;">No connections yet</div>'
              : llmConnections
                  .map(function (c) {
                    return (
                      '<div class="llm-conn-card" data-id="' +
                      c._id +
                      '" style="border:1px solid var(--glass-border-light);border-radius:10px;padding:12px 14px;margin-bottom:8px;background:rgba(255,255,255,0.03);">' +
                      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
                      '<div style="flex:1;min-width:0;">' +
                      '<div style="font-weight:600;font-size:0.95em;">' +
                      c.name +
                      "</div>" +
                      '<div style="font-size:0.8em;opacity:0.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
                      c.model +
                      " \u00B7 " +
                      c.baseUrl +
                      "</div>" +
                      "</div>" +
                      '<div style="display:flex;gap:6px;flex-shrink:0;">' +
                      '<button class="llm-save-btn" style="font-size:0.75em;padding:4px 10px;" onclick="editConnection(\'' +
                      c._id +
                      "')\">Edit</button>" +
                      '<button class="llm-disconnect-btn" style="font-size:0.75em;padding:4px 10px;" onclick="deleteConnection(\'' +
                      c._id +
                      "')\">Delete</button>" +
                      "</div>" +
                      "</div>" +
                      "</div>"
                    );
                  })
                  .join("")
          }
        </div>

        <div id="llmAddSection" style="margin-top:12px;">
          <button class="llm-save-btn" id="llmAddToggle" onclick="toggleAddForm()" style="width:100%;">+ Add Connection</button>
          <div class="llm-fields" id="llmAddForm" style="display:none;margin-top:10px;">
            <div class="llm-field-row">
              <label class="llm-field-label">Name</label>
              <input type="text" class="llm-input" id="llmName" placeholder="e.g. Groq, OpenRouter" />
            </div>
            <div class="llm-field-row">
              <label class="llm-field-label">Endpoint URL</label>
              <input type="text" class="llm-input" id="llmBaseUrl" placeholder="https://api.groq.com/openai/v1/chat/completions" />
            </div>
            <div class="llm-field-row">
              <label class="llm-field-label">API Key</label>
              <input type="password" class="llm-input" id="llmApiKey" placeholder="gsk_abc123..." />
            </div>
            <div class="llm-field-row">
              <label class="llm-field-label">Model</label>
              <input type="text" class="llm-input" id="llmModel" placeholder="openai/gpt-oss-120b" />
            </div>
            <div class="llm-btn-row">
              <button class="llm-save-btn" onclick="addConnection()">Save Connection</button>
            </div>
          </div>
        </div>

        <div id="llmEditSection" style="display:none;margin-top:12px;">
          <div style="font-weight:600;margin-bottom:8px;">Edit Connection</div>
          <input type="hidden" id="llmEditId" />
          <div class="llm-fields">
            <div class="llm-field-row">
              <label class="llm-field-label">Name</label>
              <input type="text" class="llm-input" id="llmEditName" />
            </div>
            <div class="llm-field-row">
              <label class="llm-field-label">Endpoint URL</label>
              <input type="text" class="llm-input" id="llmEditBaseUrl" />
            </div>
            <div class="llm-field-row">
              <label class="llm-field-label">API Key</label>
              <input type="password" class="llm-input" id="llmEditApiKey" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022  (leave blank to keep)" />
            </div>
            <div class="llm-field-row">
              <label class="llm-field-label">Model</label>
              <input type="text" class="llm-input" id="llmEditModel" />
            </div>
            <div class="llm-btn-row">
              <button class="llm-save-btn" onclick="updateConnection()">Update</button>
              <button class="llm-disconnect-btn" onclick="cancelEdit()">Cancel</button>
            </div>
          </div>
        </div>

        <div class="llm-status" id="llmStatus"></div>

        <!-- Failover Stack -->
        <div style="margin-top:20px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.1);">
          <div style="font-weight:600;margin-bottom:8px;">Failover Stack</div>
          <div class="llm-sub" style="margin-bottom:10px;">If your default LLM fails (rate limit, timeout), the system tries these backups in order.</div>
          <div id="failoverStack" style="min-height:30px;">
            <div style="opacity:0.4;font-size:0.85rem;">Loading...</div>
          </div>
          <div style="margin-top:8px;display:flex;gap:8px;align-items:center;">
            <select id="failoverSelect" class="llm-input" style="flex:1;">
              <option value="">Select a backup connection...</option>
              ${llmConnections.map(c => '<option value="' + c._id + '">' + c.name + ' (' + c.model + ')</option>').join("")}
            </select>
            <button class="llm-save-btn" onclick="pushFailover()" style="white-space:nowrap;">Add Backup</button>
          </div>
        </div>

      </div>
    </div>
  </div>

</div>

<!-- Terms Modal -->
<div class="modal-overlay" id="termsModal">
  <div class="modal-container">
    <div class="modal-header">
      <span class="modal-title">Terms of Service</span>
      <span class="modal-close" onclick="closeModal('terms')">\u2715</span>
    </div>
    <div class="modal-body">
      <iframe src="/terms" title="Terms of Service"></iframe>
    </div>
  </div>
</div>

<!-- Privacy Modal -->
<div class="modal-overlay" id="privacyModal">
  <div class="modal-container">
    <div class="modal-header">
      <span class="modal-title">Privacy Policy</span>
      <span class="modal-close" onclick="closeModal('privacy')">\u2715</span>
    </div>
    <div class="modal-body">
      <iframe src="/privacy" title="Privacy Policy"></iframe>
    </div>
  </div>
</div>`;

  const js = `
function loadFailoverStack() {
  fetch("/api/v1/user/${userId}/llm-failover${qs}", { headers: { "Authorization": "Bearer " + document.cookie.replace(/.*token=([^;]*).*/, "$1") } })
    .then(r => r.json())
    .then(data => {
      const el = document.getElementById("failoverStack");
      const stack = data.stack || [];
      if (stack.length === 0) {
        el.innerHTML = '<div style="opacity:0.4;font-size:0.85rem;">No backups configured. Add connections above to build your failover stack.</div>';
        return;
      }
      const conns = ${JSON.stringify(llmConnections.map(c => ({ id: c._id, name: c.name, model: c.model })))};
      el.innerHTML = stack.map((id, i) => {
        const c = conns.find(x => x.id === id);
        const label = c ? c.name + " (" + c.model + ")" : id;
        return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05);">' +
          '<span style="opacity:0.4;font-size:0.8rem;width:20px;">' + (i+1) + '.</span>' +
          '<span style="flex:1;">' + label + '</span>' +
          '<button onclick="removeFailover(\\''+id+'\\','+i+')" style="background:none;border:none;color:rgba(255,100,100,0.7);cursor:pointer;font-size:0.8rem;">remove</button>' +
        '</div>';
      }).join("");
    })
    .catch(() => {
      document.getElementById("failoverStack").innerHTML = '<div style="color:rgba(255,100,100,0.7);">Failed to load</div>';
    });
}

function pushFailover() {
  const select = document.getElementById("failoverSelect");
  const connectionId = select.value;
  if (!connectionId) return;
  fetch("/api/v1/user/${userId}/llm-failover${qs}", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + document.cookie.replace(/.*token=([^;]*).*/, "$1") },
    body: JSON.stringify({ connectionId })
  })
    .then(r => r.json())
    .then(data => {
      if (data.error) return alert(data.error);
      select.value = "";
      loadFailoverStack();
    });
}

function removeFailover(connId, index) {
  fetch("/api/v1/user/${userId}/llm-failover/" + encodeURIComponent(connId) + "${qs}", {
    method: "DELETE",
    headers: { "Authorization": "Bearer " + document.cookie.replace(/.*token=([^;]*).*/, "$1") },
  })
    .then(r => r.json())
    .then(data => {
      if (data.error) return alert(data.error);
      loadFailoverStack();
    });
}

loadFailoverStack();

var userId = "${userId}";
var currentPlan = "${plan}";
var PLAN_PRICE = { basic: 0, standard: 20, premium: 100 };
var PLAN_ORDER = ["basic", "standard", "premium"];
var ENERGY_RATE = 0.01;

var state = {
  energyAdded: 0,
  selectedPlan: null
};

// =====================
// MODAL
// =====================
function openModal(type) {
  var id = type === "terms" ? "termsModal" : "privacyModal";
  document.getElementById(id).classList.add("show");
  document.body.style.overflow = "hidden";
}

function closeModal(type) {
  var id = type === "terms" ? "termsModal" : "privacyModal";
  document.getElementById(id).classList.remove("show");
  document.body.style.overflow = "";
}

document.querySelectorAll(".modal-overlay").forEach(function(overlay) {
  overlay.addEventListener("click", function(e) {
    if (e.target === overlay) {
      overlay.classList.remove("show");
      document.body.style.overflow = "";
    }
  });
});

document.addEventListener("keydown", function(e) {
  if (e.key === "Escape") {
    document.querySelectorAll(".modal-overlay.show").forEach(function(m) {
      m.classList.remove("show");
    });
    document.body.style.overflow = "";
  }
});

// =====================
// URL STATE
// =====================
function readURL() {
  var p = new URLSearchParams(location.search);
  if (p.get("energy")) state.energyAdded = parseInt(p.get("energy")) || 0;
  if (p.get("plan") && p.get("plan") !== currentPlan) {
    state.selectedPlan = p.get("plan");
  }
}

function writeURL() {
  var p = new URLSearchParams(location.search);
  p.delete("energy");
  p.delete("plan");
  if (!p.has("html")) p.set("html", "");
  if (state.energyAdded > 0) p.set("energy", state.energyAdded);
  if (state.selectedPlan) p.set("plan", state.selectedPlan);
  history.replaceState(null, "", "?" + p.toString());
}

// =====================
// PLAN LOGIC
// =====================
function canSelectPlan(plan) {
  if (plan === "basic") return false;
  var cur = PLAN_ORDER.indexOf(currentPlan);
  var next = PLAN_ORDER.indexOf(plan);
  return next >= cur;
}

function renderPlans() {
  document.querySelectorAll(".plan-box").forEach(function(box) {
    var plan = box.dataset.plan;
    var isSelected = state.selectedPlan === plan;
    var isCurrent = plan === currentPlan && !state.selectedPlan;

    box.classList.toggle("selected", isSelected);
    box.classList.toggle("current-plan", isCurrent);
    box.classList.toggle("disabled", !canSelectPlan(plan));
  });

  var note = document.getElementById("planNote");
  if (state.selectedPlan) {
    if (state.selectedPlan === currentPlan) {
      note.textContent = "Renewing " + state.selectedPlan + " for 30 more days";
    } else {
      note.textContent = "Upgrading to " + state.selectedPlan + " for 30 days";
    }
    note.style.display = "block";
  } else {
    note.style.display = "none";
  }
}

// =====================
// ENERGY
// =====================
function renderEnergy() {
  var el = document.getElementById("energyAdded");
  var val = document.getElementById("energyAddedVal");
  if (state.energyAdded > 0) {
    el.style.display = "block";
    val.textContent = "+" + state.energyAdded + " ($" + (state.energyAdded * ENERGY_RATE).toFixed(2) + ")";
  } else {
    el.style.display = "none";
  }
}

function resetEnergy() {
  state.energyAdded = 0;
  writeURL();
  renderEnergy();
  renderCheckout();
}

function removePlan() {
  state.selectedPlan = null;
  writeURL();
  renderPlans();
  renderCheckout();
}

// =====================
// CHECKOUT
// =====================
function renderCheckout() {
  var container = document.getElementById("checkoutContent");
  var energyCost = state.energyAdded * ENERGY_RATE;
  var planCost = state.selectedPlan ? (PLAN_PRICE[state.selectedPlan] || 0) : 0;
  var total = energyCost + planCost;

  if (total <= 0) {
    container.innerHTML = '<div class="checkout-empty">Select a plan or add energy to continue</div>';
    return;
  }

  var rows = "";

  if (state.selectedPlan) {
    var label = state.selectedPlan === currentPlan
      ? "Renew " + state.selectedPlan
      : "Upgrade to " + state.selectedPlan;
    var desc = state.selectedPlan === currentPlan
      ? "+30 days added to remaining time"
      : "30-day plan starts immediately";

    rows +=
      '<div class="checkout-row">' +
        '<div class="checkout-row-left">' +
          '<div class="checkout-row-icon plan-icon">\uD83D\uDCCB</div>' +
          '<div class="checkout-row-info">' +
            '<div class="checkout-row-label">' + label + '</div>' +
            '<div class="checkout-row-desc">' + desc + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="checkout-row-right">' +
          '<div class="checkout-row-value">$' + planCost.toFixed(2) + '</div>' +
          '<span class="checkout-remove" onclick="removePlan()">\u2715</span>' +
        '</div>' +
      '</div>';
  }

  if (state.energyAdded > 0) {
    rows +=
      '<div class="checkout-row">' +
        '<div class="checkout-row-left">' +
          '<div class="checkout-row-icon energy-icon">\uD83D\uDD25</div>' +
          '<div class="checkout-row-info">' +
            '<div class="checkout-row-label">+' + state.energyAdded + ' Additional Energy</div>' +
            '<div class="checkout-row-desc">Reserve \u2014 used after plan energy</div>' +
          '</div>' +
        '</div>' +
        '<div class="checkout-row-right">' +
          '<div class="checkout-row-value">$' + energyCost.toFixed(2) + '</div>' +
          '<span class="checkout-remove" onclick="resetEnergy()">\u2715</span>' +
        '</div>' +
      '</div>';
  }

  container.innerHTML =
    '<div class="checkout-summary">' +
      rows +
      '<div class="checkout-divider"></div>' +
      '<div class="checkout-total">' +
        '<div class="checkout-total-label">Total</div>' +
        '<div class="checkout-total-value">$' + total.toFixed(2) + '</div>' +
      '</div>' +
    '</div>' +
    '<button class="checkout-btn" onclick="handleCheckout()">Pay with Stripe</button>' +
    '<div class="checkout-legal">' +
      'By purchasing, you agree to our ' +
      '<span class="checkout-legal-link" onclick="openModal(&#39;terms&#39;)">Terms of Service</span>' +
      ' and ' +
      '<span class="checkout-legal-link" onclick="openModal(&#39;privacy&#39;)">Privacy Policy</span>.' +
    '</div>' +
    '<div class="checkout-note">No recurring charges \u00B7 No refunds \u00B7 Renew manually</div>';
}

// =====================
// STRIPE CHECKOUT
// =====================
async function handleCheckout() {
  var btn = document.querySelector(".checkout-btn");
  btn.disabled = true;
  btn.textContent = "Processing\u2026";

  try {
    var body = {
      userId: userId,
      energyAmount: state.energyAdded > 0 ? state.energyAdded : 0,
      plan: state.selectedPlan || null,
      currentPlan: currentPlan,
    };

    var res = await fetch("/api/v1/user/" + userId + "/purchase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    var data = await res.json();

    if (data.url) {
      if (window.top !== window.self) {
        window.top.location.href = data.url;
      } else {
        window.location.href = data.url;
      }
    } else if (data.error) {
      alert(data.error);
      btn.disabled = false;
      btn.textContent = "Pay with Stripe";
    }
  } catch (err) {
    alert("Something went wrong. Please try again.");
    btn.disabled = false;
    btn.textContent = "Pay with Stripe";
  }
}

// =====================
// CUSTOM LLM
// =====================
var llmConnections = ${JSON.stringify(llmConnections)};

function showLlmStatus(msg, ok) {
  var el = document.getElementById("llmStatus");
  el.style.display = "block";
  el.textContent = msg;
  el.style.color = ok ? "rgba(72, 187, 120, 0.9)" : "rgba(255, 107, 107, 0.9)";
  if (ok) setTimeout(function() { el.style.display = "none"; }, 3000);
}

function toggleAddForm() {
  var form = document.getElementById("llmAddForm");
  form.style.display = form.style.display === "none" ? "block" : "none";
  document.getElementById("llmEditSection").style.display = "none";
}

async function addConnection() {
  var name = document.getElementById("llmName").value.trim();
  var baseUrl = document.getElementById("llmBaseUrl").value.trim();
  var apiKey = document.getElementById("llmApiKey").value.trim();
  var model = document.getElementById("llmModel").value.trim();

  if (!name || !baseUrl || !apiKey || !model) {
    showLlmStatus("All fields are required", false);
    return;
  }

  try {
    var res = await fetch("/api/v1/user/" + userId + "/custom-llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name, baseUrl: baseUrl, apiKey: apiKey, model: model }),
    });
    if (res.ok) {
      showLlmStatus("\u2713 Connection added", true);
      setTimeout(function() { location.reload(); }, 1000);
    } else {
      var data = await res.json().catch(function() { return {}; });
      showLlmStatus("\u2715 " + (data.error || "Failed to save"), false);
    }
  } catch (err) {
    showLlmStatus("\u2715 Network error", false);
  }
}

function editConnection(connId) {
  var conn = llmConnections.find(function(c) { return c._id === connId; });
  if (!conn) return;
  document.getElementById("llmEditId").value = connId;
  document.getElementById("llmEditName").value = conn.name;
  document.getElementById("llmEditBaseUrl").value = conn.baseUrl;
  document.getElementById("llmEditApiKey").value = "";
  document.getElementById("llmEditModel").value = conn.model;
  document.getElementById("llmEditSection").style.display = "block";
  document.getElementById("llmAddForm").style.display = "none";
}

function cancelEdit() {
  document.getElementById("llmEditSection").style.display = "none";
}

async function updateConnection() {
  var connId = document.getElementById("llmEditId").value;
  var name = document.getElementById("llmEditName").value.trim();
  var baseUrl = document.getElementById("llmEditBaseUrl").value.trim();
  var apiKey = document.getElementById("llmEditApiKey").value.trim();
  var model = document.getElementById("llmEditModel").value.trim();

  if (!baseUrl || !model) {
    showLlmStatus("Endpoint URL and Model are required", false);
    return;
  }

  var payload = { baseUrl: baseUrl, model: model };
  if (name) payload.name = name;
  if (apiKey) payload.apiKey = apiKey;

  try {
    var res = await fetch("/api/v1/user/" + userId + "/custom-llm/" + connId, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      showLlmStatus("\u2713 Connection updated", true);
      setTimeout(function() { location.reload(); }, 1000);
    } else {
      var data = await res.json().catch(function() { return {}; });
      showLlmStatus("\u2715 " + (data.error || "Failed to update"), false);
    }
  } catch (err) {
    showLlmStatus("\u2715 Network error", false);
  }
}

async function deleteConnection(connId) {
  if (!confirm("Delete this connection? This cannot be undone.")) return;
  try {
    var res = await fetch("/api/v1/user/" + userId + "/custom-llm/" + connId, {
      method: "DELETE",
    });
    if (res.ok) {
      showLlmStatus("\u2713 Deleted", true);
      setTimeout(function() { location.reload(); }, 1000);
    } else {
      showLlmStatus("\u2715 Failed to delete", false);
    }
  } catch (err) {
    showLlmStatus("\u2715 Network error", false);
  }
}

async function assignSlot(slot, connId) {
  try {
    var res = await fetch("/api/v1/user/" + userId + "/llm-assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot: slot, connectionId: connId || null }),
    });
    if (res.ok) {
      var label = slot === "main" ? "Chat" : "Raw Ideas";
      showLlmStatus(connId ? "\u2713 Assigned to " + label : "\u2713 " + label + " \u2192 default LLM", true);
    } else {
      showLlmStatus("\u2715 Failed to assign", false);
    }
  } catch (err) {
    showLlmStatus("\u2715 Network error", false);
  }
}

// =====================
// CUSTOM DROPDOWNS
// =====================
(function() {
  document.querySelectorAll(".custom-select").forEach(function(sel) {
    var trigger = sel.querySelector(".custom-select-trigger");
    trigger.addEventListener("click", function(e) {
      e.stopPropagation();
      var wasOpen = sel.classList.contains("open");
      // close all others
      document.querySelectorAll(".custom-select.open").forEach(function(s) { s.classList.remove("open"); });
      if (!wasOpen) sel.classList.add("open");
    });
    sel.querySelectorAll(".custom-select-option").forEach(function(opt) {
      opt.addEventListener("click", function(e) {
        e.stopPropagation();
        sel.querySelectorAll(".custom-select-option").forEach(function(o) { o.classList.remove("selected"); });
        opt.classList.add("selected");
        trigger.textContent = opt.textContent;
        sel.classList.remove("open");
        var val = opt.getAttribute("data-value");
        var slot = sel.getAttribute("data-slot");
        if (slot) assignSlot(slot, val);
      });
    });
  });
  document.addEventListener("click", function() {
    document.querySelectorAll(".custom-select.open").forEach(function(s) { s.classList.remove("open"); });
  });
})();

// =====================
// EVENTS
// =====================
document.querySelectorAll(".plan-box").forEach(function(box) {
  box.onclick = function() {
    var plan = box.dataset.plan;
    if (!canSelectPlan(plan)) return;

    if (state.selectedPlan === plan) {
      state.selectedPlan = null;
    } else {
      state.selectedPlan = plan;
    }

    writeURL();
    renderPlans();
    renderCheckout();
  };
});

document.querySelectorAll(".energy-buy-btn:not(#customEnergyBtn)").forEach(function(btn) {
  btn.onclick = function() {
    state.energyAdded += parseInt(btn.dataset.amount);
    writeURL();
    renderEnergy();
    renderCheckout();
  };
});

document.getElementById("customEnergyBtn").onclick = function() {
  var val = parseInt(prompt("Enter energy amount:"));
  if (!val || val <= 0) return;
  state.energyAdded += val;
  writeURL();
  renderEnergy();
  renderCheckout();
};

// =====================
// INIT
// =====================
readURL();
renderPlans();
renderEnergy();
renderCheckout();`;

  return page({
    title: `Energy \u00B7 @${user.username}`,
    css,
    body,
    js,
  });
}
