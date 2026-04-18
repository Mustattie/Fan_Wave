import { ScrollViewStyleReset } from 'expo-router/html';

export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, shrink-to-fit=no" />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: appStyles }} />
      </head>
      <body>
        <div id="phone-frame">
          <div id="status-bar">
            <span>9:41</span>
            <span className="status-right">●●●● 5G 🔋</span>
          </div>
          <div id="app-container">{children}</div>
        </div>
      </body>
    </html>
  );
}

const appStyles = `
  * {
    -webkit-tap-highlight-color: transparent;
  }

  body {
    margin: 0;
    padding: 0;
    background-color: #1a1a2e;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    overflow: hidden;
  }

  #phone-frame {
    width: 390px;
    height: 844px;
    background-color: #0f0f1a;
    border-radius: 40px;
    overflow: hidden;
    position: relative;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5), 0 0 0 3px #333;
    display: flex;
    flex-direction: column;
  }

  #status-bar {
    height: 50px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 28px;
    font-size: 14px;
    font-weight: 600;
    color: #fff;
    background-color: #0f0f1a;
    flex-shrink: 0;
    z-index: 100;
  }

  .status-right {
    font-size: 12px;
    letter-spacing: 1px;
  }

  #app-container {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  #app-container > div {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* Hide default scrollbars for clean app feel */
  ::-webkit-scrollbar {
    display: none;
  }

  /* Ensure all content respects the phone frame */
  #app-container * {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }

  @media (max-width: 430px) {
    body {
      align-items: flex-start;
    }
    #phone-frame {
      width: 100vw;
      height: 100vh;
      border-radius: 0;
      box-shadow: none;
    }
    #status-bar {
      display: none;
    }
  }
`;
