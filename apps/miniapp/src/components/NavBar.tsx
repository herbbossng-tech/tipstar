import { NavLink } from "react-router-dom";
import { NAV_ITEMS } from "../navigation.js";

export function NavBar(): JSX.Element {
  return (
    <nav className="nav-bar">
      {NAV_ITEMS.map((item) => (
        <NavLink key={item.path} to={item.path} end={item.path === "/"} className={({ isActive }) => `nav-item${isActive ? " nav-item--active" : ""}`}>
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
