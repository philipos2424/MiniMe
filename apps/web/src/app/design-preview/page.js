import { notFound } from 'next/navigation';
import Preview from './preview';

export default function Page({ searchParams }) {
  if (process.env.NODE_ENV !== 'development') notFound();
  if (searchParams.desktop === '1') return <iframe title="1440 pixel desktop preview" src="/design-preview" style={{ width: 1440, height: 1000, border: '1px solid #ddd', display: 'block' }} />;
  if (searchParams.mobile === '1') return <iframe title="390 pixel mobile preview" src="/design-preview" style={{ width: 390, height: 844, border: '1px solid #ddd', margin: '20px auto', display: 'block' }} />;
  return <Preview />;
}
