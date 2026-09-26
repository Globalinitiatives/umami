import type { SVGProps } from 'react';

const SvgLogo = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={20}
    height={20}
    viewBox="0 0 40 40"
    fill="none"
    {...props}
  >
    <circle cx="20" cy="20" r="18" stroke="currentColor" strokeWidth={2.5} />
    <path
      d="M20 11V29M20 11H29M20 11C24.5 11 27 13.5 27 18C27 22.5 24.5 25 20 25"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
export default SvgLogo;
