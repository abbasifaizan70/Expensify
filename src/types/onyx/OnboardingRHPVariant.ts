/**
 * The variant of the onboarding RHP for A/B/C/D testing. No variant opens the side panel after onboarding anymore;
 * the retired variants are kept so values the backend already assigned still parse.
 * @description 'control' - The variant with the Concierge DM
 * @description 'rhpConciergeDm' - (retired) Admin of workspace with Concierge DM
 * @description 'rhpAdminsRoom' - (retired as an experiment arm) Admin of workspace with the admins room. Still set after creating or joining a Submit workspace so the side panel defaults to #admins
 * @description 'rhpHomePage' - (retired) Navigate to Home page with Concierge Anywhere accessible in #admins room
 * @description 'trackExpensesWithConcierge' - (retired) Track workspace admins land on Home page with the side panel closed, like every other intent
 * @description 'inboxAdminsBespoke' - Bespoke welcome message delivered in #admins room instead of onboarding tasks
 * @description 'homePageNoRHP' - Land on Home with the side panel closed, at every company size. Opening Concierge shows the Concierge DM
 */
type OnboardingRHPVariant = 'rhpConciergeDm' | 'rhpAdminsRoom' | 'rhpHomePage' | 'trackExpensesWithConcierge' | 'control' | 'inboxAdminsBespoke' | 'homePageNoRHP';

export default OnboardingRHPVariant;
