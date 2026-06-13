import { NavLink } from "react-router-dom";
import "./FactorySidebar.css";

/**
 * FactorySidebar. Chapter nav for the multi-page /factory walk. Used
 * only by FactoryLayout. Each link highlights when its route is active.
 *
 * The Factory IS the stamper. Every moment of every being walks the
 * same five-beat cycle.
 *
 *    intake, assign, fold, momentum, stamped, repeat.
 *
 * The Overview page shows the cycle as a whole, and each chapter unpacks
 * one beat.
 */
const CHAPTERS = [
  { to: "/factory",             label: "Overview", end: true },
  { to: "/factory/being-types", label: "Being types"         },
  { to: "/factory/roles",       label: "Roles"               },
  { to: "/factory/branches",    label: "Branches"            },
  { to: "/factory/integrity",   label: "Integrity"           },
  { to: "/factory/identity",    label: "Identity"            },
  { to: "/factory/roots",       label: "Roots"               },
  { to: "/factory/graft",       label: "Graft & seed"        },
  { to: "/factory/intake",      label: "1. Intake"           },
  { to: "/factory/assign",      label: "2. Assign"           },
  { to: "/factory/fold",        label: "3. Fold"             },
  { to: "/factory/momentum",    label: "4. Momentum"         },
  { to: "/factory/stamped",     label: "5. Stamped"          },
];

const FactorySidebar = () => {
  return (
    <aside className="ns-sidebar" aria-label="Factory chapters">
      <div className="ns-sidebar-label">Factory</div>
      <nav className="ns-sidebar-nav">
        {CHAPTERS.map((c) => (
          <NavLink
            key={c.to}
            to={c.to}
            end={c.end}
            className={({ isActive }) =>
              isActive ? "ns-sidebar-link ns-sidebar-link--active" : "ns-sidebar-link"
            }
          >
            {c.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
};

export default FactorySidebar;
