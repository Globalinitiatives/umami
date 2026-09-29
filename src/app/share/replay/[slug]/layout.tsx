import { ReplayShareProvider } from './ReplayShareProvider';

export default async function ({
  params,
  children,
}: {
  params: Promise<{ slug: string }>;
  children: React.ReactNode;
}) {
  const { slug } = await params;

  return <ReplayShareProvider slug={slug}>{children}</ReplayShareProvider>;
}
