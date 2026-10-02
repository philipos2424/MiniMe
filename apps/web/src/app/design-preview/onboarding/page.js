import { notFound } from 'next/navigation';
import Prototype from './prototype';

export default function Page() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <Prototype />;
}
