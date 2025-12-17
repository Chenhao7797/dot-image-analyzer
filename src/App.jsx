import React, { useState, useEffect } from 'react';
import { Upload, Play, Save, Copy, Loader2, AlertCircle, CheckCircle2, Image as ImageIcon } from 'lucide-react';

// OpenCV.js URL
const OPENCV_URL = "https://docs.opencv.org/4.8.0/opencv.js";

const App = () => {
  const [cvReady, setCvReady] = useState(false);
  const [cvError, setCvError] = useState(false);
  const [selectedFunction, setSelectedFunction] = useState('d86'); // 'd86' or 'count'
  const [imageSrc, setImageSrc] = useState(null);
  const [resultImageSrc, setResultImageSrc] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [resultText, setResultText] = useState("");

  // Parameters
  const [hx, setHx] = useState("1.0");
  const [hy, setHy] = useState("1.0");
  const [energyRatio, setEnergyRatio] = useState("86"); // Default 86%
  const [minArea, setMinArea] = useState("5");
  const [blur, setBlur] = useState("0"); // 0 means none
  const [thresholdType, setThresholdType] = useState("otsu"); // 'otsu', 'binary', or number
  const [thresholdValue, setThresholdValue] = useState("127");
  const [invert, setInvert] = useState(false);

  // Load OpenCV
  useEffect(() => {
    if (window.cv) {
      setCvReady(true);
      return;
    }

    const script = document.createElement('script');
    script.src = OPENCV_URL;
    script.async = true;
    script.onload = () => {
      // opencv.js takes a moment to initialize even after load
      if (window.cv.getBuildInformation) {
        setCvReady(true);
      } else {
        window.cv['onRuntimeInitialized'] = () => {
          setCvReady(true);
        };
      }
    };
    script.onerror = () => {
      setCvError(true);
    };
    document.body.appendChild(script);

    return () => {
      // Cleanup not really possible for global script, but safer to leave it
    };
  }, []);

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setImageSrc(event.target.result);
        setResultImageSrc(null);
        setResultText("");
      };
      reader.readAsDataURL(file);
    }
  };

  // --- D86 Analysis Logic (Ported from d86_analysis.py) ---
  const analyzeD86 = async () => {
    if (!imageSrc || !cvReady) return;
    setIsProcessing(true);
    setResultText("Analyzing...");

    try {
      // Create an image element to draw on canvas
      const img = new Image();
      img.src = imageSrc;
      await new Promise(r => img.onload = r);

      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const w = canvas.width;
      const h = canvas.height;
      const data = imgData.data; // RGBA

      // 1. Convert to Gray and Calculate Energy
      // In python: Image.open().convert('L') uses formula L = R * 299/1000 + G * 587/1000 + B * 114/1000
      let E = 0;
      let pixelData = []; // Store non-zero pixels for faster iteration: {x, y, val}

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4;
          // Standard grayscale conversion
          const val = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;

          if (val > 0) {
            E += val;
            pixelData.push({ x, y, val });
          }
        }
      }

      if (E <= 0) throw new Error("Total energy is zero. Please provide a non-black image.");

      // 2. Energy Weighted Center
      let sum_cx = 0;
      let sum_cy = 0;
      for (let p of pixelData) {
        sum_cx += p.val * p.x;
        sum_cy += p.val * p.y;
      }
      const cx = sum_cx / E;
      const cy = sum_cy / E;

      // 3. Scale
      const HxVal = parseFloat(hx) || 1.0;
      const HyVal = parseFloat(hy) || 1.0;
      const s_x = HxVal / w;
      const s_y = HyVal / h;

      // 4. Covariance Matrix
      let Cov_xx = 0, Cov_yy = 0, Cov_xy = 0;

      // Optimize loop by pre-calculating dx_r, dy_r for valid pixels
      const validPixels = pixelData.map(p => {
        const dx_r = (p.x - cx) * s_x;
        const dy_r = (p.y - cy) * s_y;
        return { val: p.val, dx_r, dy_r };
      });

      for (let p of validPixels) {
        Cov_xx += p.val * p.dx_r * p.dx_r;
        Cov_yy += p.val * p.dy_r * p.dy_r;
        Cov_xy += p.val * p.dx_r * p.dy_r;
      }
      Cov_xx /= E;
      Cov_yy /= E;
      Cov_xy /= E;

      // 5. Eigen Decomposition for 2x2 Matrix
      // [[A, B], [B, C]] => characteristic eq: lambda^2 - (A+C)lambda + (AC-B^2) = 0
      const trace = Cov_xx + Cov_yy;
      const det = Cov_xx * Cov_yy - Cov_xy * Cov_xy;
      const delta = Math.sqrt(Math.pow(trace, 2) - 4 * det);
      const lambda1 = (trace + delta) / 2; // Larger eigenvalue
      const lambda2 = (trace - delta) / 2; // Smaller eigenvalue

      // Eigenvector for lambda1 (v1)
      // (A - lambda1)x + By = 0  =>  By = -(A-lambda1)x  => direction (B, lambda1 - A)
      // or (B, lambda1 - Cov_xx) if B != 0. If B=0, axes are aligned.
      let theta_rad = 0;
      if (Math.abs(Cov_xy) > 1e-9) {
        theta_rad = Math.atan2(lambda1 - Cov_xx, Cov_xy);
      } else {
        // Aligned with axes. If Cov_xx > Cov_yy, angle 0, else 90 deg (PI/2)
        theta_rad = (Cov_xx >= Cov_yy) ? 0 : Math.PI / 2;
      }
      // Normalize to 0 ~ PI
      theta_rad = theta_rad % Math.PI;
      if (theta_rad < 0) theta_rad += Math.PI;

      const a0_real = Math.sqrt(lambda1);
      const b0_real = Math.sqrt(lambda2);
      const cos_theta = Math.cos(theta_rad);
      const sin_theta = Math.sin(theta_rad);

      // 6. Project coordinates to ellipse axis
      // u = dx_r * cos + dy_r * sin
      // v = -dx_r * sin + dy_r * cos
      // Pre-calculate u, v terms squared for the loop
      const projectedPixels = validPixels.map(p => {
        const u = p.dx_r * cos_theta + p.dy_r * sin_theta;
        const v = -p.dx_r * sin_theta + p.dy_r * cos_theta;
        return { val: p.val, u2: u * u, v2: v * v };
      });

      // User defined energy percentage
      const ratio = parseFloat(energyRatio) || 86;
      const thresholdE = (ratio / 100.0) * E;

      // 7. Binary Search for Gamma
      const energyInGamma = (g) => {
        const g2 = g * g;
        const a2 = g2 * lambda1; // (gamma * a0)^2 = gamma^2 * lambda1
        const b2 = g2 * lambda2;

        let currentE = 0;
        for (let p of projectedPixels) {
          if ((p.u2 / a2) + (p.v2 / b2) <= 1.0) {
            currentE += p.val;
          }
        }
        return currentE;
      };

      let gamma_lo = 0.0;
      let gamma_hi = 1.0;

      // Extend upper bound
      while (energyInGamma(gamma_hi) < thresholdE) {
        gamma_hi *= 2.0;
        if (gamma_hi > 1e6) break;
      }

      // Binary search
      for (let i = 0; i < 60; i++) {
        const gm = (gamma_lo + gamma_hi) / 2.0;
        if (energyInGamma(gm) >= thresholdE) {
          gamma_hi = gm;
        } else {
          gamma_lo = gm;
        }
      }
      const gamma = gamma_hi;

      // 8. Final Parameters
      const a_real = gamma * a0_real;
      const b_real = gamma * b0_real;

      const a_px = a_real / s_x;
      const b_px = b_real / s_y;

      const major_axis_real = 2.0 * Math.max(a_real, b_real);
      const minor_axis_real = 2.0 * Math.min(a_real, b_real);
      const major_axis_px = 2.0 * Math.max(a_px, b_px);
      const minor_axis_px = 2.0 * Math.min(a_px, b_px);

      const circle_tol = 0.05;
      const is_circle = Math.abs(a_real - b_real) / Math.max(a_real, b_real) < circle_tol;

      let radius_real = null;
      let angle_deg = (theta_rad * 180.0 / Math.PI) % 180.0;

      let resStr = `Analysis Result (${ratio}% Energy):\n`;
      if (is_circle) {
        radius_real = gamma * a0_real; // Approx
        resStr += `Shape: Circle (Approx)\n`;
        resStr += `Diameter (Actual Unit): ${(radius_real * 2).toFixed(6)}\n`;
      } else {
        resStr += `Shape: Ellipse\n`;
        resStr += `Major Axis (Actual Unit): ${major_axis_real.toFixed(6)}\n`;
        resStr += `Minor Axis (Actual Unit): ${minor_axis_real.toFixed(6)}\n`;
        resStr += `Angle (Degrees): ${angle_deg.toFixed(2)}\n`;
      }
      resStr += `Gamma: ${gamma.toFixed(6)}`;

      setResultText(resStr);

      // 9. Draw Result
      // Re-draw original on canvas
      ctx.drawImage(img, 0, 0);

      // Draw Center
      ctx.fillStyle = '#00FF00';
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, 2 * Math.PI);
      ctx.fill();

      // Draw Ellipse/Circle
      ctx.strokeStyle = '#FF0000';
      ctx.lineWidth = 2;
      ctx.beginPath();

      if (is_circle) {
        const rx = radius_real / s_x;
        const ry = radius_real / s_y;
        ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
      } else {
        ctx.ellipse(cx, cy, a_px, b_px, theta_rad, 0, 2 * Math.PI);
      }
      ctx.stroke();

      setResultImageSrc(canvas.toDataURL());

    } catch (err) {
      console.error(err);
      setResultText(`Error: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // --- Counting Logic (Ported from counting.py) ---
  const countPoints = async () => {
    if (!imageSrc || !cvReady) return;
    setIsProcessing(true);
    setResultText("Counting...");

    try {
      const imgElement = document.createElement('img');
      imgElement.src = imageSrc;
      await new Promise(r => imgElement.onload = r);

      const src = window.cv.imread(imgElement);
      const dst = new window.cv.Mat();
      const gray = new window.cv.Mat();

      // 1. Gray
      window.cv.cvtColor(src, gray, window.cv.COLOR_RGBA2GRAY, 0);

      // 2. Blur
      const blurVal = parseFloat(blur);
      if (blurVal > 0) {
        let k = Math.floor(blurVal);
        if (k % 2 === 0) k += 1;
        const ksize = new window.cv.Size(k, k);
        window.cv.GaussianBlur(gray, gray, ksize, 0, 0, window.cv.BORDER_DEFAULT);
      }

      // 3. Threshold
      let bw = new window.cv.Mat();
      if (thresholdType === 'otsu') {
        window.cv.threshold(gray, bw, 0, 255, window.cv.THRESH_BINARY + window.cv.THRESH_OTSU);
      } else if (thresholdType === 'binary') {
        window.cv.threshold(gray, bw, 127, 255, window.cv.THRESH_BINARY);
      } else {
        const t = parseInt(thresholdValue) || 127;
        window.cv.threshold(gray, bw, t, 255, window.cv.THRESH_BINARY);
      }

      if (invert) {
        window.cv.bitwise_not(bw, bw);
      }

      // 4. Connected Components
      const labels = new window.cv.Mat();
      const stats = new window.cv.Mat();
      const centroids = new window.cv.Mat();
      const connectivity = 8;

      const numLabels = window.cv.connectedComponentsWithStats(bw, labels, stats, centroids, connectivity, window.cv.CV_32S);

      // 5. Filter and Count
      let count = 0;
      const minAreaVal = parseInt(minArea) || 5;

      const color = new window.cv.Scalar(255, 0, 0, 255);

      for (let i = 1; i < numLabels; i++) { // 0 is background
        const area = stats.intAt(i, window.cv.CC_STAT_AREA);
        if (area >= minAreaVal) {
          count++;
          const x = stats.intAt(i, window.cv.CC_STAT_LEFT);
          const y = stats.intAt(i, window.cv.CC_STAT_TOP);
          const w = stats.intAt(i, window.cv.CC_STAT_WIDTH);
          const h = stats.intAt(i, window.cv.CC_STAT_HEIGHT);

          const point1 = new window.cv.Point(x, y);
          const point2 = new window.cv.Point(x + w, y + h);
          window.cv.rectangle(src, point1, point2, color, 2, window.cv.LINE_8, 0);
        }
      }

      setResultText(`Count ≈ ${count}`);

      // Show result
      window.cv.imshow('resultCanvas', src); // We need a hidden canvas or reference to extract dataURL
      const resultCanvas = document.getElementById('resultCanvas');
      setResultImageSrc(resultCanvas.toDataURL());

      // Cleanup
      src.delete(); dst.delete(); gray.delete(); bw.delete();
      labels.delete(); stats.delete(); centroids.delete();

    } catch (err) {
      console.error(err);
      setResultText(`Error: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const runAnalysis = () => {
    if (selectedFunction === 'd86') {
      analyzeD86();
    } else {
      countPoints();
    }
  };

  const copyToClipboard = async () => {
    if (!resultImageSrc) return;
    try {
      const response = await fetch(resultImageSrc);
      const blob = await response.blob();
      await navigator.clipboard.write([
        new ClipboardItem({
          [blob.type]: blob
        })
      ]);
      alert("Image copied to clipboard");
    } catch (err) {
      console.error(err);
      alert("Copy failed");
    }
  };

  const saveImage = () => {
    if (!resultImageSrc) return;
    const link = document.createElement('a');
    link.href = resultImageSrc;
    link.download = `result_${selectedFunction}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6 font-sans text-gray-800">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <h1 className="text-3xl font-bold text-center text-gray-900 mb-2">Image Analysis Tool</h1>
          <div className="flex justify-center items-center gap-2 text-sm text-gray-500">
            {cvReady ? (
              <span className="flex items-center text-green-600 font-medium">
                <CheckCircle2 className="w-4 h-4 mr-1" /> OpenCV Ready
              </span>
            ) : cvError ? (
              <span className="flex items-center text-red-600 font-medium">
                <AlertCircle className="w-4 h-4 mr-1" /> OpenCV Failed to Load
              </span>
            ) : (
              <span className="flex items-center text-blue-600 font-medium">
                <Loader2 className="w-4 h-4 mr-1 animate-spin" /> Loading OpenCV...
              </span>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 grid grid-cols-1 md:grid-cols-12 gap-6">

          {/* Function Select */}
          <div className="md:col-span-3 space-y-4">
            <label className="block text-sm font-semibold text-gray-700">Select Function</label>
            <select
              className="w-full p-2.5 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition"
              value={selectedFunction}
              onChange={(e) => setSelectedFunction(e.target.value)}
            >
              <option value="d86">Energy Analysis (D86)</option>
              <option value="count">Count Points</option>
            </select>

            <label className="block w-full cursor-pointer">
              <span className="sr-only">Upload Image</span>
              <div className="w-full flex items-center justify-center px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition group">
                <div className="space-y-1 text-center">
                  <Upload className="mx-auto h-6 w-6 text-gray-400 group-hover:text-blue-500" />
                  <div className="text-sm text-gray-500 group-hover:text-blue-600">Upload Image</div>
                </div>
              </div>
              <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
            </label>
          </div>

          {/* Parameters */}
          <div className="md:col-span-6 grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-semibold text-gray-700 mb-2">Parameters</label>
            </div>

            {selectedFunction === 'd86' ? (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Hx (Actual Width)</label>
                  <input type="number" step="0.1" value={hx} onChange={(e) => setHx(e.target.value)} className="w-full p-2 border border-gray-300 rounded-md" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Hy (Actual Height)</label>
                  <input type="number" step="0.1" value={hy} onChange={(e) => setHy(e.target.value)} className="w-full p-2 border border-gray-300 rounded-md" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Energy Ratio (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="1"
                    max="100"
                    value={energyRatio}
                    onChange={(e) => setEnergyRatio(e.target.value)}
                    className="w-full p-2 border border-gray-300 rounded-md"
                  />
                  <p className="text-xs text-gray-400 mt-1">e.g., 86 for 86%</p>
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Min Area (px)</label>
                  <input type="number" value={minArea} onChange={(e) => setMinArea(e.target.value)} className="w-full p-2 border border-gray-300 rounded-md" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Blur (Kernel Size)</label>
                  <input type="number" value={blur} onChange={(e) => setBlur(e.target.value)} className="w-full p-2 border border-gray-300 rounded-md" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Threshold Mode</label>
                  <select value={thresholdType} onChange={(e) => setThresholdType(e.target.value)} className="w-full p-2 border border-gray-300 rounded-md">
                    <option value="otsu">Otsu (Auto)</option>
                    <option value="binary">Binary (127)</option>
                    <option value="custom">Custom Value</option>
                  </select>
                </div>
                {thresholdType === 'custom' && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Threshold (0-255)</label>
                    <input type="number" value={thresholdValue} onChange={(e) => setThresholdValue(e.target.value)} className="w-full p-2 border border-gray-300 rounded-md" />
                  </div>
                )}
                <div className="col-span-2 flex items-center mt-2">
                  <input
                    type="checkbox"
                    id="invert"
                    checked={invert}
                    onChange={(e) => setInvert(e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 border-gray-300"
                  />
                  <label htmlFor="invert" className="ml-2 text-sm text-gray-700">Invert Color (Black dots on White)</label>
                </div>
              </>
            )}
          </div>

          {/* Action Button */}
          <div className="md:col-span-3 flex flex-col justify-end space-y-3">
            <button
              onClick={runAnalysis}
              disabled={!cvReady || !imageSrc || isProcessing}
              className={`w-full py-3 px-4 rounded-lg flex items-center justify-center font-bold text-white transition shadow-sm
                  ${!cvReady || !imageSrc || isProcessing
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 active:scale-95'}`}
            >
              {isProcessing ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Play className="w-5 h-5 mr-2" />}
              Analyze
            </button>
          </div>
        </div>

        {/* Results Area */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Original Image */}
          <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex flex-col h-[500px]">
            <h3 className="text-lg font-semibold text-gray-700 mb-3 flex items-center">
              <ImageIcon className="w-5 h-5 mr-2" /> Original Image
            </h3>
            <div className="flex-1 bg-gray-100 rounded-lg flex items-center justify-center overflow-hidden relative">
              {imageSrc ? (
                <img src={imageSrc} alt="Original" className="max-w-full max-h-full object-contain" />
              ) : (
                <span className="text-gray-400">No Image Loaded</span>
              )}
            </div>
          </div>

          {/* Result Image */}
          <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex flex-col h-[500px]">
            <h3 className="text-lg font-semibold text-gray-700 mb-3 flex items-center justify-between">
              <span className="flex items-center"><CheckCircle2 className="w-5 h-5 mr-2" /> Analysis Result</span>
              <div className="flex gap-2">
                <button onClick={copyToClipboard} disabled={!resultImageSrc} className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-full transition" title="Copy Image">
                  <Copy className="w-5 h-5" />
                </button>
                <button onClick={saveImage} disabled={!resultImageSrc} className="p-2 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded-full transition" title="Download Image">
                  <Save className="w-5 h-5" />
                </button>
              </div>
            </h3>
            <div className="flex-1 bg-gray-100 rounded-lg flex items-center justify-center overflow-hidden relative">
              {resultImageSrc ? (
                <img src={resultImageSrc} alt="Result" className="max-w-full max-h-full object-contain" />
              ) : (
                <span className="text-gray-400">Waiting for Result...</span>
              )}
            </div>
          </div>
        </div>

        {/* Text Results */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-700 mb-2">Data Report</h3>
          <pre className="bg-gray-50 p-4 rounded-lg text-sm text-gray-800 font-mono whitespace-pre-wrap border border-gray-200">
            {resultText || "No Data Available."}
          </pre>
        </div>

        {/* Hidden Canvas for OpenCV Operations */}
        <canvas id="resultCanvas" className="hidden"></canvas>
      </div>
    </div>
  );
};

export default App;
