// Story CC-7.12 D11: the old planner address opens Looks on Plan, where the planner lives now.
// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
import { Redirect } from 'expo-router'

export default function PlannerRoute() {
  return <Redirect href={{ pathname: '/looks', params: { segment: 'plan' } }} />
}
