export function TrafficLights() {
  return (
    <div className="h-12 flex items-center px-6 gap-2 titlebar-drag">
      <button
        className="traffic-light traffic-light-close no-drag"
        onClick={() => window.electronAPI.closeWindow()}
        title="Close"
      />
      <button
        className="traffic-light traffic-light-minimize no-drag"
        onClick={() => window.electronAPI.minimizeWindow()}
        title="Minimize"
      />
      <button
        className="traffic-light traffic-light-maximize no-drag"
        onClick={() => window.electronAPI.maximizeWindow()}
        title="Maximize"
      />
    </div>
  );
}
