from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import json
import os

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"

@app.route('/api/groq/chat', methods=['POST'])
def groq_chat():
    """
    Proxy endpoint untuk Groq API
    Menerima request dari frontend dan forward ke Groq API
    """
    try:
        # Get data from frontend
        data = request.get_json()
        
        # Extract API key from headers
        api_key = request.headers.get('X-API-Key')
        
        if not api_key:
            return jsonify({
                'error': 'API Key tidak ditemukan. Kirim API key di header X-API-Key'
            }), 400
        
        # Prepare headers for Groq API
        headers = {
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json'
        }
        
        # Forward request to Groq API
        response = requests.post(
            GROQ_API_URL,
            headers=headers,
            json=data,
            timeout=60
        )
        
        # Return response from Groq API
        if response.status_code == 200:
            return jsonify(response.json()), 200
        else:
            return jsonify({
                'error': f'Groq API Error: {response.text}',
                'status_code': response.status_code
            }), response.status_code
            
    except requests.exceptions.Timeout:
        return jsonify({
            'error': 'Request timeout. Groq API tidak merespon.'
        }), 504
        
    except requests.exceptions.RequestException as e:
        return jsonify({
            'error': f'Network error: {str(e)}'
        }), 500
        
    except Exception as e:
        return jsonify({
            'error': f'Server error: {str(e)}'
        }), 500

@app.route('/api/health', methods=['GET'])
def health_check():
    """
    Health check endpoint
    """
    return jsonify({
        'status': 'ok',
        'message': 'Backend server is running'
    }), 200

@app.route('/', methods=['GET'])
def home():
    """
    Home endpoint dengan informasi API
    """
    return jsonify({
        'name': 'Groq Autonomous Agent Backend',
        'version': '1.0.0',
        'endpoints': {
            '/api/health': 'Health check',
            '/api/groq/chat': 'Proxy to Groq API (POST)'
        },
        'usage': {
            'method': 'POST',
            'url': '/api/groq/chat',
            'headers': {
                'Content-Type': 'application/json',
                'X-API-Key': 'your-groq-api-key'
            },
            'body': {
                'model': 'llama-3.3-70b-versatile',
                'messages': [
                    {'role': 'system', 'content': 'You are a helpful assistant'},
                    {'role': 'user', 'content': 'Hello!'}
                ]
            }
        }
    }), 200

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))  # ← Pakai PORT dari Railway
    
    print("=" * 60)
    print("🚀 Groq Autonomous Agent Backend")
    print(f"✓ Server running on port: {port}")
    print("=" * 60)
    
    app.run(host='0.0.0.0', port=port, debug=False)
