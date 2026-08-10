import { clearSessionCookie } from '@/lib/auth';
import { handleError, ok } from '@/lib/api';

export async function POST() {
  try {
    await clearSessionCookie();
    return ok({ message: 'Signed out' });
  } catch (error) {
    return handleError(error);
  }
}
