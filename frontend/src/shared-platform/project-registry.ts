import {sharedNavigationFallback} from "../shared-navigation/menu.generated";
export const canonicalProjectRegistry = [{...sharedNavigationFallback.brand,label:"Hub"},...sharedNavigationFallback.projects] as const;

export type ProjectId = (typeof canonicalProjectRegistry)[number]['id'] | 'momentum' | 'best-factor';

export function getCanonicalNavigation(currentId: ProjectId) {
  if (!canonicalProjectRegistry.some((project) => project.id === (currentId === "momentum" ? "factor" : currentId))) {
    throw new RangeError(`Unknown project id: ${currentId}`);
  }
  return canonicalProjectRegistry.map((project) => ({
    ...project,
    current: project.id === (currentId === "momentum" ? "factor" : currentId),
  }));
}
