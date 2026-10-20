import { useEffect, useState } from "react";
import { sharedNavigationFallback } from "./menu.generated";
const normalizeNavigationId = (id: string) => id === "momentum" ? "factor" : id;

export interface SharedMenuEntry { id: string; label: string; url: string }
export interface SharedMenu { schemaVersion: "quant-navigation/v1"; brand: SharedMenuEntry; projects: readonly SharedMenuEntry[] }
interface NavigationRuntime { getMenu(): SharedMenu; getLinks(menu: SharedMenu, current: string): Array<SharedMenuEntry & {current: boolean}> }
declare global { interface Window { QuantNavigationV1?: NavigationRuntime } }
export const SHARED_NAVIGATION_BASE = "https://sonchanggi.github.io/quant-dashboard/shared/navigation/v1/";
/** React owns its link nodes; the shared runtime only provides validated data. */
export function useSharedNavigation(currentProject: string) {
  const [menu, setMenu] = useState<SharedMenu>(sharedNavigationFallback);
  useEffect(() => {
    let active = true;
    const hadNavigationClass = document.body.classList.contains("has-quant-shared-nav");
    document.body.classList.add("has-quant-shared-nav");
    const update = () => { if (active && window.QuantNavigationV1) setMenu(window.QuantNavigationV1.getMenu()); };
    window.document.addEventListener("quant-navigation-ready", update);
    if (!document.querySelector('link[data-quant-navigation-css]')) {
      const css = document.createElement("link"); css.rel = "stylesheet"; css.href = SHARED_NAVIGATION_BASE + "nav.css"; css.dataset.quantNavigationCss = "true"; document.head.appendChild(css);
    }
    if (!window.QuantNavigationV1 && !document.querySelector('script[data-quant-navigation-runtime]')) {
      const script = document.createElement("script"); script.src = SHARED_NAVIGATION_BASE + "nav.js"; script.defer = true; script.dataset.quantNavigationRuntime = "true"; script.addEventListener("load", update, {once: true}); document.head.appendChild(script);
    }
    update();
    return () => { active = false; document.removeEventListener("quant-navigation-ready", update); if (!hadNavigationClass) document.body.classList.remove("has-quant-shared-nav"); };
  }, []);
  const current = normalizeNavigationId(currentProject);
  return {brand: {...menu.brand, current: current === "hub"}, navigation: menu.projects.map(project => ({...project, current: project.id === current}))};
}
