'use client';
import { useState } from 'react';
import GuidedOnboarding from '../../../components/onboarding/GuidedOnboarding';

export default function Prototype() {
  const [round, setRound] = useState(0);
  return <GuidedOnboarding key={round} preview onExit={() => setRound(n => n + 1)} />;
}
