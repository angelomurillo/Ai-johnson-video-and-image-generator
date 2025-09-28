import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Modality } from '@google/genai';

type GalleryItem = {
  id: string;
  type: 'video' | 'image';
  dataUrl: string;
  prompt: string;
};

type Mode = 'video' | 'image' | 'pic-to-vid' | 'pic-to-pic';

const modeConfig = {
    video: { placeholder: "e.g., A neon hologram of a cat driving a sports car", buttonText: "Generate Video" },
    image: { placeholder: "e.g., A majestic lion wearing a crown, studio lighting", buttonText: "Generate Image" },
    'pic-to-vid': { placeholder: "e.g., Make the car drive through a futuristic city", buttonText: "Generate Video" },
    'pic-to-pic': { placeholder: "e.g., Add a futuristic helmet to the lion", buttonText: "Generate Image" },
};

const App = () => {
  const [prompt, setPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMessage, setLoadingMessage] = useState('');

  const [mode, setMode] = useState<Mode>('video');
  const [view, setView] = useState<'generator' | 'gallery'>('generator');
  const [uploadedImage, setUploadedImage] = useState<{ file: File, dataUrl: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [latestResult, setLatestResult] = useState<GalleryItem | null>(null);
  const [gallery, setGallery] = useState<GalleryItem[]>(() => {
    try {
      const savedGallery = localStorage.getItem('aiJohnsonGallery');
      return savedGallery ? JSON.parse(savedGallery) : [];
    } catch {
      return [];
    }
  });

  const [isFetchingPrompt, setIsFetchingPrompt] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [recentPrompts, setRecentPrompts] = useState<string[]>(() => {
    try {
        const savedPrompts = localStorage.getItem('aiJohnsonRecentPrompts');
        return savedPrompts ? JSON.parse(savedPrompts) : [];
    } catch {
        return [];
    }
  });
  const historyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem('aiJohnsonGallery', JSON.stringify(gallery));
  }, [gallery]);
  
  const loadingMessages = [
    'Brewing up your creation...',
    'This can take a few minutes, please be patient.',
    'Rendering pixels into motion...',
    'Composing the perfect scene...',
    'Almost there, adding the finishing touches...',
  ];

  useEffect(() => {
    let interval: number;
    if (isLoading) {
      setLoadingMessage(loadingMessages[0]);
      let messageIndex = 1;
      interval = window.setInterval(() => {
        setLoadingMessage(loadingMessages[messageIndex % loadingMessages.length]);
        messageIndex++;
      }, 5000);
    }
    return () => clearInterval(interval);
  }, [isLoading]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
        if (historyRef.current && !historyRef.current.contains(event.target as Node)) {
            setShowHistory(false);
        }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
        document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = (reader.result as string).split(',')[1];
        resolve(base64String);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const saveRecentPrompt = (newPrompt: string) => {
    if (!newPrompt.trim()) return;
    const updatedPrompts = [newPrompt, ...recentPrompts.filter(p => p.toLowerCase() !== newPrompt.toLowerCase())].slice(0, 10);
    setRecentPrompts(updatedPrompts);
    localStorage.setItem('aiJohnsonRecentPrompts', JSON.stringify(updatedPrompts));
  };
  
  const handleGenerate = async () => {
    if (!prompt || isLoading) return;
    if ((mode === 'pic-to-vid' || mode === 'pic-to-pic') && !uploadedImage) {
        setError('Please upload an image for this mode.');
        return;
    }

    setIsLoading(true);
    setLatestResult(null);
    setError(null);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
      let newItem: GalleryItem;

      switch (mode) {
        case 'video':
        case 'pic-to-vid':
            const imagePayload = mode === 'pic-to-vid' && uploadedImage ? {
                image: {
                    imageBytes: await blobToBase64(uploadedImage.file),
                    mimeType: uploadedImage.file.type,
                }
            } : {};

            let operation = await ai.models.generateVideos({
              model: 'veo-2.0-generate-001',
              prompt: prompt,
              ...imagePayload,
              config: {
                numberOfVideos: 1,
              },
            });

            while (!operation.done) {
              await new Promise(resolve => setTimeout(resolve, 10000));
              operation = await ai.operations.getVideosOperation({ operation: operation });
            }

            const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
            if (!downloadLink) throw new Error('Video generation failed to return a valid link.');

            const videoResponse = await fetch(`${downloadLink}&key=${process.env.API_KEY}`);
            if (!videoResponse.ok) throw new Error(`Failed to fetch video: ${videoResponse.statusText}`);
            
            const videoBlob = await videoResponse.blob();
            const objectUrl = URL.createObjectURL(videoBlob);
            
            newItem = { id: Date.now().toString(), type: 'video', dataUrl: objectUrl, prompt };
            break;

        case 'image':
            const imageResponse = await ai.models.generateImages({
                model: 'imagen-4.0-generate-001',
                prompt: prompt,
                config: {
                  numberOfImages: 1,
                  outputMimeType: 'image/jpeg',
                },
            });
            const base64ImageBytes = imageResponse.generatedImages[0].image.imageBytes;
            const imageUrl = `data:image/jpeg;base64,${base64ImageBytes}`;
            newItem = { id: Date.now().toString(), type: 'image', dataUrl: imageUrl, prompt };
            break;

        case 'pic-to-pic':
            if (!uploadedImage) throw new Error('No image uploaded for Pic-to-Pic mode.');
            const imageBase64 = await blobToBase64(uploadedImage.file);
            
            const editResponse = await ai.models.generateContent({
              model: 'gemini-2.5-flash-image-preview',
              contents: {
                parts: [
                  { inlineData: { data: imageBase64, mimeType: uploadedImage.file.type } },
                  { text: prompt },
                ],
              },
              config: {
                  responseModalities: [Modality.IMAGE, Modality.TEXT],
              },
            });
            
            const imagePart = editResponse.candidates[0].content.parts.find(p => p.inlineData);
            if (!imagePart || !imagePart.inlineData) {
                throw new Error("The model did not return an image.");
            }
            const editedImageBytes = imagePart.inlineData.data;
            const editedImageUrl = `data:${imagePart.inlineData.mimeType};base64,${editedImageBytes}`;
            newItem = { id: Date.now().toString(), type: 'image', dataUrl: editedImageUrl, prompt };
            break;
      }
      
      saveRecentPrompt(prompt);
      setLatestResult(newItem);
      setGallery(prev => [newItem, ...prev]);

    } catch (e) {
      setError((e as Error).message);
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSurpriseMe = async () => {
    setIsFetchingPrompt(true);
    setError(null);
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
        const generationType = (mode === 'video' || mode === 'pic-to-vid') ? 'video' : 'image';
        const contextPrompt = `You are a creative assistant. Generate a short, single-sentence, visually descriptive prompt for an AI ${generationType} generator. The prompt should be imaginative and avoid clichés. Do not wrap it in quotes.`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: contextPrompt,
        });

        const newPrompt = response.text.trim().replace(/^"|"$/g, '');
        setPrompt(newPrompt);
    } catch (e) {
        setError("Could not generate a prompt. Please try again.");
        console.error(e);
    } finally {
        setIsFetchingPrompt(false);
    }
  };

  const handleDelete = (id: string) => {
    const itemToDelete = gallery.find(item => item.id === id);
    if (itemToDelete?.type === 'video' && itemToDelete.dataUrl.startsWith('blob:')) {
        URL.revokeObjectURL(itemToDelete.dataUrl);
    }
    setGallery(prev => prev.filter(item => item.id !== id));
  };
  
  const handleDownload = async (item: GalleryItem) => {
    const a = document.createElement('a');
    a.href = item.dataUrl;
    a.download = `${item.type}_${item.id}.${item.type === 'video' ? 'mp4' : 'jpg'}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadedImage({ file, dataUrl: URL.createObjectURL(file) });
    }
  };
  
  const handleModeChange = (newMode: Mode) => {
    if (mode !== newMode) {
      setMode(newMode);
      setPrompt('');
      setUploadedImage(null);
      setError(null);
      setLatestResult(null);
    }
  };

  const renderGenerator = () => (
    <div className="form">
      <div className="options-group">
        <div className="mode-selector">
          <button className={`mode-button ${mode === 'video' ? 'active' : ''}`} onClick={() => handleModeChange('video')} aria-pressed={mode === 'video'}>Video</button>
          <button className={`mode-button ${mode === 'image' ? 'active' : ''}`} onClick={() => handleModeChange('image')} aria-pressed={mode === 'image'}>Image</button>
          <button className={`mode-button ${mode === 'pic-to-vid' ? 'active' : ''}`} onClick={() => handleModeChange('pic-to-vid')} aria-pressed={mode === 'pic-to-vid'}>Pic-to-Vid</button>
          <button className={`mode-button ${mode === 'pic-to-pic' ? 'active' : ''}`} onClick={() => handleModeChange('pic-to-pic')} aria-pressed={mode === 'pic-to-pic'}>Pic-to-Pic</button>
        </div>
      </div>

      {(mode === 'pic-to-vid' || mode === 'pic-to-pic') && (
        <div className="image-uploader-wrapper">
          {!uploadedImage ? (
            <div className="image-uploader" onClick={() => fileInputRef.current?.click()} role="button" tabIndex={0} onKeyPress={(e) => e.key === 'Enter' && fileInputRef.current?.click()}>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageUpload} style={{ display: 'none' }} aria-hidden="true" />
              <p>Click to upload an image</p>
            </div>
          ) : (
            <div className="image-preview">
              <img src={uploadedImage.dataUrl} alt="Upload preview" />
              <button onClick={() => { URL.revokeObjectURL(uploadedImage.dataUrl); setUploadedImage(null); }} className="remove-image-btn" aria-label="Remove uploaded image">&times;</button>
            </div>
          )}
        </div>
      )}

      <div className="prompt-wrapper">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={modeConfig[mode].placeholder}
          aria-label="Generation prompt"
          disabled={isLoading || isFetchingPrompt}
        />
        <div className="prompt-actions">
            <button 
                className="action-icon-button" 
                onClick={handleSurpriseMe} 
                disabled={isLoading || isFetchingPrompt}
                title="Surprise Me"
                aria-label="Generate a random prompt"
            >
                {isFetchingPrompt ? <div className="mini-loader"></div> : <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2.5a2.5 2.5 0 0 0-5 0 2.5 2.5 0 0 0 5 0Z"/><path d="M5 21a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2"/><path d="M12 22V7"/><path d="m10 5 2 2 2-2"/></svg>}
            </button>
            {recentPrompts.length > 0 && (
                <button 
                    className="action-icon-button" 
                    onClick={() => setShowHistory(s => !s)} 
                    disabled={isLoading}
                    title="Recent Prompts"
                    aria-label="Show recent prompts"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>
                </button>
            )}
        </div>
        {showHistory && recentPrompts.length > 0 && (
            <div className="history-dropdown" ref={historyRef}>
                <ul>
                    {recentPrompts.map((p, i) => (
                        <li key={i} onClick={() => { setPrompt(p); setShowHistory(false); }}>
                            {p}
                        </li>
                    ))}
                </ul>
            </div>
        )}
      </div>

      <button onClick={handleGenerate} className="generate-button" disabled={isLoading || !prompt || ((mode === 'pic-to-vid' || mode === 'pic-to-pic') && !uploadedImage)}>
        {isLoading ? 'Generating...' : modeConfig[mode].buttonText}
      </button>

      <div className="results">
        {isLoading && (
          <div className="loader-container" role="status" aria-live="polite">
            <div className="loader"></div>
            <p className="loading-message">{loadingMessage}</p>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        {latestResult && (
            <div className="result-container">
                <h3>Your Latest Creation!</h3>
                {latestResult.type === 'video' ? 
                    <video src={latestResult.dataUrl} controls autoPlay loop playsInline aria-label="Generated AI video" /> :
                    <img src={latestResult.dataUrl} alt={latestResult.prompt} aria-label="Generated AI image" />
                }
                <button onClick={() => handleDownload(latestResult)} className="action-button download-btn download-button">Download</button>
            </div>
        )}
      </div>
    </div>
  );
  
  const renderGallery = () => (
    <div className="gallery">
      {gallery.length === 0 ? (
        <p>Your gallery is empty. Generate some videos or images to see them here!</p>
      ) : (
        <div className="gallery-grid">
          {gallery.map(item => (
            <div key={item.id} className="gallery-item">
              {item.type === 'video' ? 
                <video src={item.dataUrl} loop muted controls playsInline onMouseOver={e => e.currentTarget.play()} onMouseOut={e => e.currentTarget.pause()} /> :
                <img src={item.dataUrl} alt={item.prompt} />
              }
              <div className="gallery-item-info">
                <p className="gallery-item-prompt">{item.prompt}</p>
                <div className="gallery-item-actions">
                  <button onClick={() => handleDownload(item)} className="action-button download-btn">Download</button>
                  <button onClick={() => handleDelete(item.id)} className="action-button delete-btn">Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="container">
      <header>
        <h1>AI Johnson</h1>
        <nav>
          <button className={`nav-button ${view === 'generator' ? 'active' : ''}`} onClick={() => setView('generator')} aria-pressed={view === 'generator'}>Generator</button>
          <button className={`nav-button ${view === 'gallery' ? 'active' : ''}`} onClick={() => setView('gallery')} aria-pressed={view === 'gallery'}>Gallery ({gallery.length})</button>
        </nav>
      </header>
      {view === 'generator' ? renderGenerator() : renderGallery()}
    </div>
  );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);