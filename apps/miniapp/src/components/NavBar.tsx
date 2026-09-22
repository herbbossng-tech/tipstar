import { NavLink } from "react-router-dom";
import { NAV_ITEMS } from "../navigation.js";
import { haptics } from "../telegram/haptics.js";

export function NavBar(): JSX.Element {
  return (
    <nav className="nav-bar" aria-label="Primary">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          end={item.path === "/"}
          onClick={() => haptics.selection()}
          className={({ isActive }) => `nav-item${isActive ? " nav-item--active" : ""}`}
        >
          {({ isActive }) => (
            <span aria-current={isActive ? "page" : undefined}>{item.label}</span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
