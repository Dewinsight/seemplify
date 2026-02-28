import * as React from 'react';
import { Input, InputProps } from './input';
import { sanitizeInput } from '@/utils/security';

export interface SecureInputProps extends InputProps {
  onSanitizedChange?: (value: string) => void;
  allowHtml?: boolean;
}

export const SecureInput = React.forwardRef<HTMLInputElement, SecureInputProps>(
  ({ onChange, onSanitizedChange, allowHtml = false, ...props }, ref) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const rawValue = e.target.value;
      
      // Sanitize the input value
      const sanitizedValue = allowHtml ? rawValue : sanitizeInput(rawValue);
      
      // Call the sanitized change handler if provided
      if (onSanitizedChange) {
        onSanitizedChange(sanitizedValue);
      }
      
      if (!onChange) {
        return;
      }

      if (sanitizedValue === rawValue) {
        onChange(e);
        return;
      }

      // Create a synthetic event with the sanitized value
      const syntheticEvent = {
        ...e,
        target: { ...e.target, value: sanitizedValue },
        currentTarget: { ...e.currentTarget, value: sanitizedValue }
      } as React.ChangeEvent<HTMLInputElement>;

      onChange(syntheticEvent);
    };
    
    return (
      <Input
        ref={ref}
        onChange={handleChange}
        {...props}
      />
    );
  }
);

SecureInput.displayName = 'SecureInput';
