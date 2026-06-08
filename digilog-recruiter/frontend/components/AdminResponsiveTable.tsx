"use client";

import { useState, ReactNode, useEffect } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { ChevronDown, ChevronUp, ChevronRight, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface Column<T> {
  header: string;
  accessorKey: keyof T | string;
  cell?: (item: T) => ReactNode;
  enableSorting?: boolean;
  priority: 'high' | 'medium' | 'low'; // Used to determine visibility on different screen sizes
}

interface AdminResponsiveTableProps<T> {
  data: T[];
  columns: Column<T>[];
  loading?: boolean;
  emptyMessage?: string;
  searchPlaceholder?: string;
  onSearch?: (searchTerm: string) => void;
  initialSearchTerm?: string;
  pagination?: {
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
  };
}

export default function AdminResponsiveTable<T extends { [key: string]: any }>({
  data,
  columns,
  loading = false,
  emptyMessage = 'No data available',
  searchPlaceholder = 'Search...',
  onSearch,
  initialSearchTerm = '',
  pagination,
}: AdminResponsiveTableProps<T>) {
  const [searchTerm, setSearchTerm] = useState(initialSearchTerm);
  const [expandedRows, setExpandedRows] = useState<Record<string | number, boolean>>({});
  const [sortConfig, setSortConfig] = useState<{
    key: keyof T | string;
    direction: 'asc' | 'desc';
  } | null>(null);
  const [screenSize, setScreenSize] = useState<'sm' | 'md' | 'lg' | 'xl'>('xl');

  // Update screen size on resize
  useEffect(() => {
    const updateScreenSize = () => {
      const width = window.innerWidth;
      if (width < 640) {
        setScreenSize('sm');
      } else if (width < 768) {
        setScreenSize('md');
      } else if (width < 1024) {
        setScreenSize('lg');
      } else {
        setScreenSize('xl');
      }
    };

    updateScreenSize();
    window.addEventListener('resize', updateScreenSize);
    return () => window.removeEventListener('resize', updateScreenSize);
  }, []);

  // Filter columns based on screen size
  const visibleColumns = columns.filter((column) => {
    if (screenSize === 'sm') {
      return column.priority === 'high';
    }
    if (screenSize === 'md') {
      return column.priority === 'high' || column.priority === 'medium';
    }
    return true; // Show all columns on large screens
  });

  const handleSort = (key: keyof T | string) => {
    const column = columns.find(col => col.accessorKey === key);
    if (!column?.enableSorting) return;
    
    let direction: 'asc' | 'desc' = 'asc';
    
    if (sortConfig && sortConfig.key === key) {
      direction = sortConfig.direction === 'asc' ? 'desc' : 'asc';
    }
    
    setSortConfig({ key, direction });
  };
  
  const sortedData = [...data];
  if (sortConfig) {
    sortedData.sort((a, b) => {
      // Handle nested properties with dot notation
      const getNestedProperty = (obj: any, path: string) => {
        return path.split('.').reduce((o, key) => (o ? o[key] : null), obj);
      };
      
      const aValue = getNestedProperty(a, sortConfig.key as string);
      const bValue = getNestedProperty(b, sortConfig.key as string);
      
      if (aValue === bValue) return 0;
      
      const result = aValue > bValue ? 1 : -1;
      return sortConfig.direction === 'asc' ? result : -result;
    });
  }

  const toggleRowExpand = (rowId: string | number) => {
    setExpandedRows((prev) => ({
      ...prev,
      [rowId]: !prev[rowId]
    }));
  };

  const handleSearch = () => {
    onSearch?.(searchTerm);
  };
  
  // Generate a unique ID for each row
  const getRowId = (row: T, index: number) => {
    return row.id || row._id || row.uuid || `row-${index}`;
  };

  return (
    <div className="w-full space-y-4">
      {/* Search Box */}
      {onSearch && (
        <Card className="bg-gray-800 border-gray-700 mb-4">
          <div className="p-4">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                <Input
                  placeholder={searchPlaceholder}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  className="pl-10 bg-gray-700 border-gray-600 text-white"
                />
              </div>
              <Button 
                onClick={handleSearch}
                className="bg-blue-600 hover:bg-blue-700 whitespace-nowrap"
              >
                Search
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Table Container */}
      <div className="overflow-x-auto rounded-md border border-gray-700">
        <Table>
          <TableHeader className="bg-gray-800">
            <TableRow className="border-gray-700 hover:bg-gray-800">
              {/* Expand column for mobile view */}
              {screenSize === 'sm' && (
                <TableHead className="w-10 text-gray-400"></TableHead>
              )}
              
              {visibleColumns.map((column) => (
                <TableHead 
                  key={column.accessorKey as string} 
                  className={cn(
                    "text-gray-400",
                    column.enableSorting ? "cursor-pointer select-none" : ""
                  )}
                  onClick={() => column.enableSorting && handleSort(column.accessorKey)}
                >
                  <div className="flex items-center space-x-1">
                    <span>{column.header}</span>
                    {column.enableSorting && sortConfig?.key === column.accessorKey && (
                      sortConfig.direction === 'asc' 
                        ? <ChevronUp className="h-4 w-4" /> 
                        : <ChevronDown className="h-4 w-4" />
                    )}
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody className="bg-gray-800">
            {loading ? (
              <TableRow className="border-gray-700 hover:bg-gray-800">
                <TableCell 
                  colSpan={visibleColumns.length + (screenSize === 'sm' ? 1 : 0)} 
                  className="text-center text-gray-400 py-8"
                >
                  <div className="flex flex-col items-center justify-center p-4">
                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500 mb-2"></div>
                    <p>Loading data...</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : sortedData.length === 0 ? (
              <TableRow className="border-gray-700 hover:bg-gray-800">
                <TableCell 
                  colSpan={visibleColumns.length + (screenSize === 'sm' ? 1 : 0)} 
                  className="text-center text-gray-400 py-8"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              sortedData.map((item, index) => {
                const rowId = getRowId(item, index);
                const isExpanded = expandedRows[rowId];
                
                return (
                  <React.Fragment key={rowId}>
                    <TableRow className="border-gray-700 hover:bg-gray-700/50">
                      {/* Expand button for mobile view */}
                      {screenSize === 'sm' && (
                        <TableCell className="w-10 pr-0">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            onClick={() => toggleRowExpand(rowId)}
                          >
                            <ChevronRight 
                              className={`h-5 w-5 text-gray-400 transition-transform ${
                                isExpanded ? 'rotate-90' : ''
                              }`}
                            />
                          </Button>
                        </TableCell>
                      )}
                      
                      {/* Visible columns */}
                      {visibleColumns.map((column) => (
                        <TableCell key={column.accessorKey as string} className="text-gray-300">
                          {column.cell ? column.cell(item) : (
                            <span className="line-clamp-2">
                              {/* Handle nested properties with dot notation */}
                              {String(column.accessorKey.toString().split('.').reduce(
                                (o, key) => (o ? o[key] : '—'), item
                              ) || '—')}
                            </span>
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                    
                    {/* Expanded row for mobile view */}
                    {screenSize === 'sm' && isExpanded && (
                      <TableRow className="border-gray-700 bg-gray-900/50">
                        <TableCell colSpan={visibleColumns.length + 1} className="p-0">
                          <div className="p-4 space-y-3">
                            {columns
                              .filter(col => col.priority !== 'high')
                              .map(column => (
                                <div key={column.accessorKey as string} className="flex flex-col">
                                  <span className="text-xs font-medium text-gray-400">
                                    {column.header}
                                  </span>
                                  <div className="text-gray-300">
                                    {column.cell ? column.cell(item) : (
                                      String(column.accessorKey.toString().split('.').reduce(
                                        (o, key) => (o ? o[key] : '—'), item
                                      ) || '—')
                                    )}
                                  </div>
                                </div>
                              ))
                            }
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex justify-center mt-6 space-x-2">
          <Button
            onClick={() => pagination.onPageChange(pagination.currentPage - 1)}
            disabled={pagination.currentPage <= 1 || loading}
            variant="outline"
            className="bg-gray-800 border-gray-700 text-white hover:bg-gray-700"
            size="sm"
          >
            Previous
          </Button>
          <span className="flex items-center px-4 text-gray-400 text-sm">
            Page {pagination.currentPage} of {pagination.totalPages}
          </span>
          <Button
            onClick={() => pagination.onPageChange(pagination.currentPage + 1)}
            disabled={pagination.currentPage >= pagination.totalPages || loading}
            variant="outline"
            className="bg-gray-800 border-gray-700 text-white hover:bg-gray-700"
            size="sm"
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
