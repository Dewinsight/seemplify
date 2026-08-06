import React from 'react';
import { CheckCircle, AlertCircle, XCircle, Info, X } from 'lucide-react';

const Alert = ({
  type = 'info',
  title,
  message,
  onClose,
  className = '',
  closable = false,
}) => {
  const icons = {
    success: CheckCircle,
    error: XCircle,
    warning: AlertCircle,
    info: Info,
  };

  const typeClasses = {
    success: 'bg-green-50 border-green-200 text-green-800',
    error: 'bg-red-50 border-red-200 text-red-800',
    warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    info: 'bg-blue-50 border-blue-200 text-blue-800',
  };

  const iconClasses = {
    success: 'text-green-400',
    error: 'text-red-400',
    warning: 'text-yellow-400',
    info: 'text-blue-400',
  };

  const Icon = icons[type];

  return (
    <div className={`border rounded-lg p-4 ${typeClasses[type]} ${className}`}>
      <div className="flex items-start">
        <Icon className={`h-5 w-5 mt-0.5 mr-3 flex-shrink-0 ${iconClasses[type]}`} />
        <div className="flex-1 min-w-0">
          {title && (
            <h3 className="text-sm font-medium mb-1">
              {title}
            </h3>
          )}
          {message && (
            <p className="text-sm">
              {message}
            </p>
          )}
        </div>
        {closable && onClose && (
          <button
            onClick={onClose}
            className="ml-3 flex-shrink-0 rounded-md p-1 hover:bg-black hover:bg-opacity-10 transition-colors"
            aria-label="Close alert"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
};

export default Alert;
