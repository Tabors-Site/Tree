/* ------------------------------------------------- */
/* Calendar page (extracted from root.js)            */
/* ------------------------------------------------- */

import { page } from "../layout.js";

export function renderCalendar({ rootId, queryString, month, year, byDay }) {
  const css = `
    body { color: white; }
    .container { max-width: 1200px; }

    /* Glass Card Base */
    .glass-card {
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.28);
      position: relative;
      overflow: hidden;
    }

    .glass-card::before {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background: linear-gradient(
        180deg,
        rgba(255,255,255,0.18),
        rgba(255,255,255,0.05)
      );
      pointer-events: none;
    }

    /* Header */
    .header {
      padding: 24px 28px;
      margin-bottom: 20px;
      animation: fadeInUp 0.5s ease-out;
    }

    .header-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
    }

    .nav-controls {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .nav-button {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      border: 1px solid rgba(255, 255, 255, 0.3);
      background: rgba(255, 255, 255, 0.2);
      color: white;
      font-size: 18px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15),
        inset 0 1px 0 rgba(255, 255, 255, 0.3);
    }

    .nav-button:hover {
      background: rgba(255, 255, 255, 0.3);
      transform: scale(1.1);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
    }

    .month-label {
      font-size: 20px;
      font-weight: 700;
      color: white;
      min-width: 200px;
      text-align: center;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      letter-spacing: -0.3px;
    }

    .clock {
      font-size: 14px;
      color: rgba(255, 255, 255, 0.9);
      font-weight: 500;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }

    /* Calendar Grid - Desktop */
    .calendar-grid {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 12px;
      padding: 24px;
      animation: fadeInUp 0.6s ease-out;
    }

    .day-header {
      background: rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(10px);
      border-radius: 10px;
      padding: 12px;
      text-align: center;
      font-weight: 700;
      font-size: 14px;
      color: white;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1),
        inset 0 1px 0 rgba(255, 255, 255, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.25);
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }

    .day-cell {
      background: rgba(255, 255, 255, 0.15);
      backdrop-filter: blur(10px);
      border-radius: 12px;
      padding: 12px;
      min-height: 120px;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.2);
      position: relative;
      overflow: hidden;
    }

    .day-cell::before {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background: linear-gradient(
        180deg,
        rgba(255,255,255,0.15),
        rgba(255,255,255,0.05)
      );
      pointer-events: none;
    }

    .day-cell:hover {
      transform: translateY(-4px);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2);
      background: rgba(255, 255, 255, 0.25);
      border-color: rgba(255, 255, 255, 0.4);
    }

    .day-cell.other-month {
      opacity: 0.4;
    }

    .day-number {
      font-weight: 700;
      font-size: 16px;
      color: white;
      margin-bottom: 8px;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
      position: relative;
      z-index: 1;
    }

    .day-cell.today .day-number {
      background: rgba(255, 255, 255, 0.3);
      color: white;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      box-shadow: 0 0 20px rgba(255, 255, 255, 0.5),
        inset 0 1px 0 rgba(255, 255, 255, 0.4);
      border: 2px solid rgba(255, 255, 255, 0.5);
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% {
        box-shadow: 0 0 20px rgba(255, 255, 255, 0.5),
                    inset 0 1px 0 rgba(255, 255, 255, 0.4);
      }
      50% {
        box-shadow: 0 0 30px rgba(255, 255, 255, 0.7),
                    inset 0 1px 0 rgba(255, 255, 255, 0.6);
      }
    }

    .node-item {
      display: block;
      margin: 4px 0;
      padding: 6px 10px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.25);
      color: white;
      font-size: 12px;
      font-weight: 600;
      text-decoration: none;
      transition: all 0.2s;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      position: relative;
      z-index: 1;
    }

    .node-item:hover {
      background: rgba(255, 255, 255, 0.35);
      transform: translateX(2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .node-count {
      display: inline-block;
      margin-top: 4px;
      padding: 4px 8px;
      background: rgba(255, 255, 255, 0.2);
      color: white;
      font-size: 11px;
      font-weight: 700;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.25);
      position: relative;
      z-index: 1;
    }

    /* List View - Mobile */
    .calendar-list {
      display: none;
      padding: 16px;
      gap: 12px;
    }

    .list-day {
      background: rgba(255, 255, 255, 0.15);
      backdrop-filter: blur(10px);
      border-radius: 12px;
      padding: 16px;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.2);
      position: relative;
      overflow: hidden;
    }

    .list-day::before {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background: linear-gradient(
        180deg,
        rgba(255,255,255,0.15),
        rgba(255,255,255,0.05)
      );
      pointer-events: none;
    }

    .list-day:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
      background: rgba(255, 255, 255, 0.2);
    }

    .list-day-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      position: relative;
      z-index: 1;
    }

    .list-day-date {
      font-weight: 700;
      font-size: 16px;
      color: white;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }

    .list-day-badge {
      padding: 4px 12px;
      background: rgba(255, 255, 255, 0.25);
      color: white;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 700;
      border: 1px solid rgba(255, 255, 255, 0.3);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    /* Day View */
    .day-view {
      padding: 24px;
      animation: fadeInUp 0.6s ease-out;
    }

    .hour-row {
      display: flex;
      border-bottom: 1px solid rgba(255, 255, 255, 0.15);
      padding: 12px 0;
      min-height: 60px;
      transition: background 0.2s;
    }

    .hour-row:hover {
      background: rgba(255, 255, 255, 0.08);
      border-radius: 8px;
    }

    .hour-label {
      width: 80px;
      font-weight: 700;
      color: white;
      font-size: 14px;
      flex-shrink: 0;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }

    .hour-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .empty-state {
      text-align: center;
      padding: 60px 40px;
      color: rgba(255, 255, 255, 0.8);
    }

    .empty-state-icon {
      font-size: 64px;
      margin-bottom: 16px;
      opacity: 0.6;
    }

    /* Mobile Responsive */
    @media (max-width: 768px) {
      body {
        padding: 12px;
      }

      .header {
        padding: 16px;
      }

      .header-top {
        flex-direction: column;
        align-items: stretch;
      }

      .nav-controls {
        justify-content: center;
      }

      .clock {
        text-align: center;
      }

      /* Switch to list view on mobile */
      .calendar-grid {
        display: none;
      }

      .calendar-list {
        display: flex;
        flex-direction: column;
      }

      .day-view {
        padding: 16px;
      }

      .hour-label {
        width: 60px;
        font-size: 12px;
      }

      .month-label {
        font-size: 18px;
      }

      .nav-button {
        width: 36px;
        height: 36px;
        font-size: 16px;
      }
    }
`;

  const body = `
  <div class="container">
    <!-- Header -->
    <div class="glass-card header">
      <div class="header-top">
        <a href="/api/v1/root/${rootId}${queryString}" class="back-link" id="backLink">
          <- Back to Tree
        </a>

        <div class="nav-controls">
          <button class="nav-button" id="prevMonth"><-</button>
          <div class="month-label" id="monthLabel"></div>
          <button class="nav-button" id="nextMonth">-></button>
        </div>

        <div class="clock" id="clock"></div>
      </div>
    </div>

    <!-- Calendar Container -->
    <div class="glass-card" id="calendarContainer"></div>
  </div>
`;

  const js = `
    const params = new URLSearchParams(window.location.search);
    const dayMode = params.get("day");
    const calendarData = ${JSON.stringify(byDay)};
    const month = ${month};
    const year = ${year};

    const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const dayNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

    const container = document.getElementById("calendarContainer");
    const monthLabel = document.getElementById("monthLabel");
    const backLink = document.getElementById("backLink");

    // Clock
    function tick() {
      document.getElementById("clock").textContent = new Date().toLocaleString();
    }
    tick();
    setInterval(tick, 1000);

    // Format hour for day view
    function formatHour(h) {
      if (h === 0) return "12 AM";
      if (h < 12) return h + " AM";
      if (h === 12) return "12 PM";
      return (h - 12) + " PM";
    }

    // Render Day View
    function renderDayView(dayKey) {
      monthLabel.textContent = dayKey;
      backLink.textContent = "<- Back to Month";
      backLink.onclick = (e) => {
        e.preventDefault();
        const p = new URLSearchParams(window.location.search);
        p.delete("day");
        window.location.search = p.toString();
      };

      const items = (calendarData[dayKey] || []).slice().sort(
        (a, b) => new Date(a.schedule) - new Date(b.schedule)
      );

      const byHour = {};
      for (const item of items) {
        const d = new Date(item.schedule);
        const h = d.getHours();
        if (!byHour[h]) byHour[h] = [];
        byHour[h].push(item);
      }

      let html = '<div class="day-view">';

      if (items.length === 0) {
        html += '<div class="empty-state"><div class="empty-state-icon">\\ud83d\\udcc5</div><div>No scheduled items for this day</div></div>';
      } else {
        for (let h = 0; h < 24; h++) {
          html += \`
            <div class="hour-row">
              <div class="hour-label">\${formatHour(h)}</div>
              <div class="hour-content">
          \`;

          (byHour[h] || []).forEach(item => {
            html += \`<a class="node-item" href="/api/v1/node/\${item.nodeId}/\0${queryString}">\${item.name}</a>\`;
          });

          html += '</div></div>';
        }
      }

      html += '</div>';
      container.innerHTML = html;
    }

    // Render Month View
    function renderMonthView() {
      monthLabel.textContent = monthNames[month] + " " + year;

      const firstDay = new Date(year, month, 1);
      const start = new Date(firstDay);
      start.setDate(1 - firstDay.getDay());

      const today = new Date();
      const todayStr = today.toISOString().slice(0, 10);

      const isMobile = window.innerWidth <= 768;

      if (isMobile) {
        // List view for mobile
        let html = '<div class="calendar-list">';

        const daysWithEvents = [];
        for (let i = 0; i < 42; i++) {
          const d = new Date(start);
          d.setDate(start.getDate() + i);
          const key = d.toISOString().slice(0, 10);
          const items = calendarData[key] || [];

          if (items.length > 0 || d.getMonth() === month) {
            daysWithEvents.push({ date: d, key, items });
          }
        }

        if (daysWithEvents.length === 0) {
          html += '<div class="empty-state"><div class="empty-state-icon">\\ud83d\\udcc5</div><div>No scheduled items this month</div></div>';
        } else {
          daysWithEvents.forEach(({ date, key, items }) => {
            const dayOfWeek = dayNames[date.getDay()];
            const isToday = key === todayStr;

            html += \`
              <div class="list-day" onclick="goToDay('\${key}')">
                <div class="list-day-header">
                  <div class="list-day-date">
                    \${dayOfWeek}, \${monthNames[date.getMonth()]} \${date.getDate()}
                    \${isToday ? ' <span style="text-shadow: 0 0 10px rgba(255,255,255,0.8);">\\u2728 Today</span>' : ''}
                  </div>
                  \${items.length > 0 ? \`<span class="list-day-badge">\${items.length} item\${items.length !== 1 ? 's' : ''}</span>\` : ''}
                </div>
            \`;

            if (items.length > 0) {
              items.slice(0, 3).forEach(item => {
                html += \`<a class="node-item" href="/api/v1/node/\${item.nodeId}/\0${queryString}" onclick="event.stopPropagation()">\${item.name}</a>\`;
              });

              if (items.length > 3) {
                html += \`<div class="node-count">+\${items.length - 3} more</div>\`;
              }
            }

            html += '</div>';
          });
        }

        html += '</div>';
        container.innerHTML = html;
      } else {
        // Grid view for desktop
        let html = '<div class="calendar-grid">';

        // Day headers
        dayNames.forEach(day => {
          html += \`<div class="day-header">\${day}</div>\`;
        });

        // Days
        for (let i = 0; i < 42; i++) {
          const d = new Date(start);
          d.setDate(start.getDate() + i);
          const key = d.toISOString().slice(0, 10);
          const items = calendarData[key] || [];
          const isOtherMonth = d.getMonth() !== month;
          const isToday = key === todayStr;

          html += \`
            <div class="day-cell \${isOtherMonth ? 'other-month' : ''} \${isToday ? 'today' : ''}" onclick="goToDay('\${key}')">
              <div class="day-number">\${d.getDate()}</div>
          \`;

          items.slice(0, 3).forEach(item => {
            html += \`<a class="node-item" href="/api/v1/node/\${item.nodeId}/\0${queryString}" onclick="event.stopPropagation()">\${item.name}</a>\`;
          });

          if (items.length > 3) {
            html += \`<div class="node-count">+\${items.length - 3} more</div>\`;
          }

          html += '</div>';
        }

        html += '</div>';
        container.innerHTML = html;
      }
    }

    // Navigate to day
    function goToDay(key) {
      const p = new URLSearchParams(window.location.search);
      p.set("day", key);
      window.location.search = p.toString();
    }

    // Navigation buttons
    document.getElementById("prevMonth").onclick = () => {
      const p = new URLSearchParams(window.location.search);

      if (dayMode) {
        const d = new Date(dayMode);
        d.setDate(d.getDate() - 1);
        p.set("day", d.toISOString().slice(0, 10));
      } else {
        let m = month - 1;
        let y = year;
        if (m < 0) { m = 11; y--; }
        p.set("month", m);
        p.set("year", y);
      }

      window.location.search = p.toString();
    };

    document.getElementById("nextMonth").onclick = () => {
      const p = new URLSearchParams(window.location.search);

      if (dayMode) {
        const d = new Date(dayMode);
        d.setDate(d.getDate() + 1);
        p.set("day", d.toISOString().slice(0, 10));
      } else {
        let m = month + 1;
        let y = year;
        if (m > 11) { m = 0; y++; }
        p.set("month", m);
        p.set("year", y);
      }

      window.location.search = p.toString();
    };

    // Initial render
    if (dayMode) {
      renderDayView(dayMode);
    } else {
      renderMonthView();
    }

    // Re-render on resize
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!dayMode) renderMonthView();
      }, 250);
    });
`;

  return page({
    title: "Calendar",
    css,
    body,
    js,
  });
}
