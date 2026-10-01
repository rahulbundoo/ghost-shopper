import { useLoaderData, type LoaderFunctionArgs } from 'react-router';
import { merchantRead, required } from '../merchant.server';
import { RunDetails } from '../components/run-details';
export function loader({ request, params }: LoaderFunctionArgs) {
  return merchantRead(request, async (service) => {
    const run = required(await service.getTestRun(params.runId));
    const [steps, artifacts, analyses, aiAnalyses] = await Promise.all([
      service.listRunSteps(run.id),
      service.listArtifacts(run.id),
      service.listRunAnalyses(run.id),
      service.listAiAnalyses(run.id),
    ]);
    return { run, steps, artifacts, analyses, aiAnalyses };
  });
}
export default function RunPage() {
  const data = useLoaderData<typeof loader>();
  return <RunDetails key={data.run.id} data={data} />;
}
export { PageError as ErrorBoundary } from '../components/merchant';
