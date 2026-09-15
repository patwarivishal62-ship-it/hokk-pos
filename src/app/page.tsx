import { redirect } from 'next/navigation';
import { isInitialized } from '@/lib/bootstrap';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function RootPage() {
  if (!isInitialized()) redirect('/setup');
  const user = await getCurrentUser();
  redirect(user ? '/dashboard' : '/login');
}
