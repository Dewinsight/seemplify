import { cn } from "@/lib/utils";

interface HRLogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
  textColor?: string;
  bgClassName?: string;
}

export const HRLogo = ({
  size = 'md',
  className,
  textColor = "text-white",
  bgClassName = "bg-gradient-to-br from-blue-400 to-purple-500"
}: HRLogoProps) => {
  const sizeClasses = {
    xs: {
      container: "w-6 h-6 rounded",
      text: "text-xs",
    },
    sm: {
      container: "w-8 h-8 rounded-md",
      text: "text-xs",
    },
    md: {
      container: "w-10 h-10 rounded-lg",
      text: "text-sm",
    },
    lg: {
      container: "w-12 h-12 rounded-lg",
      text: "text-base",
    },
  };

  const selectedSize = sizeClasses[size];

  return (
    <div className={cn("flex items-center justify-center", className)}>
      <div
        className={cn(
          bgClassName,
          "flex items-center justify-center shadow-lg",
          selectedSize.container
        )}
      >
        <span className={cn("font-extrabold tracking-tighter", textColor, selectedSize.text)}>
          HR
        </span>
      </div>
    </div>
  );
};
