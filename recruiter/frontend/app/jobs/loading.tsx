export default function Loading() {
  return (
    <div className="min-h-screen bg-[rgb(var(--background-start-rgb))] relative overflow-hidden">
      <div className="bg-noise" />
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-900/10 via-blue-900/10 to-teal-900/10 blur-3xl" />
      <div className="relative z-10 flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-4">
          <div className="relative h-16 w-16">
            <div className="absolute inset-0 rounded-full border-t-2 border-r-2 border-blue-500 animate-spin" />
            <div className="absolute inset-2 rounded-full border-b-2 border-l-2 border-teal-500 animate-spin-reverse" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-blue-500 to-teal-600 animate-pulse" />
            </div>
          </div>
          <div className="text-center">
            <h3 className="text-xl font-semibold text-white mb-1">Loading Jobs</h3>
            <p className="text-zinc-400 text-sm">Preparing your recruitment dashboard...</p>
          </div>
        </div>
      </div>
    </div>
  )
}
